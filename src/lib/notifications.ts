// The global instance and an inert `msg` descriptor, not a hook: channel
// registration runs from an effect, not a render. `setNotificationChannelAsync`
// re-runs on every push registration, so a language switch renames the channel
// on the next return to the foreground.
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import {
  registerDevicePushToken,
  unregisterDevicePushToken,
  type GatewayEndpoint,
} from '@/lib/gateway-client';
import {
  answerApprovalFromNotification,
  approvalActionDecision,
  registerApprovalNotificationCategory,
} from '@/lib/approval-notifications';
import { feedback } from '@/lib/feedback';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { notificationRoute } from '@/lib/notification-route';
import { useAppSettings } from '@/stores/app-settings';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: useAppSettings.getState().notificationsEnabled,
    shouldShowList: useAppSettings.getState().notificationsEnabled,
  }),
});

/**
 * A stored gateway, found by the server id a push carries. A notification may
 * be about a server the app is not currently connected to, so the approval
 * request is pointed at the record rather than at the global client config.
 */
function endpointForServer(serverId: string): GatewayEndpoint | null {
  const { record, records } = useGatewayConnectionStore.getState();
  const match =
    records.find((entry) => entry.serverId === serverId) ??
    (record?.serverId === serverId ? record : null);
  return match
    ? {
        url: match.url,
        token: match.token,
        deviceId: match.deviceId,
        transportKey: match.transportKey,
        transport: match.transport,
      }
    : null;
}

export function useNotificationObserver() {
  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const route = notificationRoute(
        notification.request.content.data,
        notification.request.identifier
      );
      if (route) router.navigate(route as Href);
    }

    /**
     * An approval action answers the agent directly. Only a failure -- an
     * unreachable gateway, or a `409` because the menu moved on -- falls back
     * to opening the pane, where the banner asks the question properly.
     */
    async function handleResponse(response: Notifications.NotificationResponse) {
      const decision = approvalActionDecision(response.actionIdentifier);
      if (!decision) {
        redirect(response.notification);
        return;
      }
      const { outcome } = await answerApprovalFromNotification(
        response.notification.request.content.data,
        decision,
        endpointForServer
      );
      if (outcome === 'answered') {
        void feedback('success');
        await Notifications.dismissNotificationAsync(
          response.notification.request.identifier
        ).catch(() => undefined);
        return;
      }
      void feedback('warning');
      redirect(response.notification);
    }

    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) {
      void handleResponse(response);
      void Notifications.clearLastNotificationResponseAsync();
    }

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      void handleResponse(nextResponse);
    });
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      if (!useAppSettings.getState().notificationsEnabled) return;
      const data = notification.request.content.data;
      const eventType = String(data?.type ?? data?.event ?? '').toLowerCase();
      void feedback(eventType.includes('block') ? 'warning' : 'success');
    });
    return () => {
      responseSubscription.remove();
      receivedSubscription.remove();
    };
  }, []);
}

export function useGatewayPushRegistration(record: GatewayRecord | null) {
  const notificationsEnabled = useAppSettings((state) => state.notificationsEnabled);

  useEffect(() => {
    if (!notificationsEnabled) {
      void unregisterPushNotificationsAsync(Boolean(record)).catch(() => undefined);
      return;
    }
    if (!record) return;
    let cancelled = false;
    let registeredToken: string | null = null;

    async function register() {
      try {
        const token = await registerForPushNotificationsAsync();
        if (cancelled || !token || token === registeredToken) return;
        await registerDevicePushToken({
          token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          device_name: Device.deviceName ?? Device.modelName ?? undefined,
        });
        registeredToken = token;
      } catch (error) {
        // Registration is retried when the app next enters the foreground.
        if (__DEV__) console.warn('Push notification registration failed.', error);
      }
    }

    void register();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void register();
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
    };
  }, [notificationsEnabled, record]);
}

async function unregisterPushNotificationsAsync(removeFromGateway: boolean): Promise<void> {
  if (process.env.EXPO_OS === 'web') return;
  if (removeFromGateway) {
    const token = await currentExpoPushTokenAsync();
    if (token) {
      await unregisterDevicePushToken(token).catch(() => undefined);
    }
  }
  await Notifications.unregisterForNotificationsAsync();
}

async function currentExpoPushTokenAsync(): Promise<string | null> {
  const permissions = await Notifications.getPermissionsAsync();
  if (!hasNotificationPermission(permissions)) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('gateway', {
      name: i18n._(msg`Gateway updates`),
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF5A4A',
    });
  }

  // The buttons an approval push offers. Registered before any push can arrive,
  // because both platforms resolve a notification's actions from the category
  // as it stood at delivery. Best-effort: a failure here costs the buttons, not
  // the notification.
  await registerApprovalNotificationCategory().catch((error: unknown) => {
    if (__DEV__) console.warn('Registering the approval notification category failed.', error);
  });

  const existingPermissions = await Notifications.getPermissionsAsync();
  const permissions = hasNotificationPermission(existingPermissions)
    ? existingPermissions
    : await Notifications.requestPermissionsAsync();
  if (!hasNotificationPermission(permissions)) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Expo projectId is required for push notifications.');

  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

function hasNotificationPermission(permissions: Notifications.NotificationPermissionsStatus): boolean {
  if (Platform.OS !== 'ios') return permissions.status === 'granted';

  const iosStatus = permissions.ios?.status;
  return iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED
    || iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
    || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL;
}
