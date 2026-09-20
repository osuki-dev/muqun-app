import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';

import AppDrawer from '@/components/app-drawer';
import { ServerTerminalWorkspace } from '@/components/server-terminal-workspace';
import { Text } from '@/components/text';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import type { HomeServerEntry } from '@/lib/home-commands';
import { homeWorkspaceHostStore, homeWorkspaceRouteMode } from '@/lib/home-workspace-owner';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useServerSession } from '@/stores/server-session';

/**
 * Compact/deep-link entry.
 *
 * On a wide Home, the root route already owns the retained task workspace.
 * Native stack freezing keeps that route mounted when this path is pushed, so
 * mounting another terminal here would create a second connection and draft.
 * Hand the route target to the root owner and return there instead.
 */
export default function ServerScreen() {
  const {
    serverId: rawServerId,
    sessionId: rawSessionId,
    workspaceId: rawWorkspaceId,
    tabId: rawTabId,
    paneId: rawPaneId,
  } = useLocalSearchParams<{
    serverId: string;
    sessionId?: string;
    workspaceId?: string;
    tabId?: string;
    paneId?: string;
  }>();
  const serverId = param(rawServerId);
  const sessionId = param(rawSessionId);
  const workspaceId = param(rawWorkspaceId);
  const tabId = param(rawTabId);
  const paneId = param(rawPaneId);
  const router = useRouter();
  const { selectRecord, selectRecordNow } = useGatewayRecord();
  const rootOwnerServerId = useSyncExternalStore(
    homeWorkspaceHostStore.subscribe,
    () => homeWorkspaceHostStore.getState().serverId,
    () => homeWorkspaceHostStore.getState().serverId
  );
  const routeMode = homeWorkspaceRouteMode(rootOwnerServerId);
  const [transferState, setTransferState] = useState<'pending' | 'missing' | null>(null);
  const transferRequest = useRef(0);

  useEffect(() => {
    if (routeMode === 'route-owner' || !serverId) {
      setTransferState(null);
      return;
    }

    const request = ++transferRequest.current;
    let active = true;
    let committed = false;
    setTransferState('pending');

    // These stores are the existing route-to-owner bridge. Write the complete
    // destination before selecting the record so a frozen Home owner cannot
    // paint its remembered pane for one frame before the requested target.
    if (sessionId) useServerSession.getState().chooseSession({ serverId, sessionId });
    if (paneId) usePanelPickerStore.getState().choosePanel({ serverId, paneId });
    const target: HomeServerEntry = {
      kind: 'gateway-terminal',
      serverId,
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(tabId ? { tabId } : {}),
      ...(paneId ? { paneId } : {}),
    };
    const handoffId = homeWorkspaceHandoffStore
      .getState()
      .publish(
        target,
        () => active && request === transferRequest.current,
        rootOwnerServerId ?? undefined
      );

    const returnToHome = (selected: boolean) => {
      if (!active || request !== transferRequest.current) return;
      // The root owner can disappear while selection is in flight (for
      // example, an unpair or an authoritative empty hydration). In that
      // case this route must take ownership instead of dismissing into a
      // Home list that no longer has a task host.
      if (!homeWorkspaceHostStore.getState().serverId) {
        if (homeWorkspaceHandoffStore.getState().handoff?.id === handoffId)
          homeWorkspaceHandoffStore.getState().clear();
        setTransferState(null);
        return;
      }
      if (!selected) {
        if (homeWorkspaceHandoffStore.getState().handoff?.id === handoffId)
          homeWorkspaceHandoffStore.getState().clear();
        setTransferState('missing');
        return;
      }
      committed = true;
      // Home remains mounted below this frozen stack entry. Dismissing to it
      // reveals that existing root instead of replacing the route with a new
      // index entry (which would leave two Home owners in the stack).
      router.dismissTo('/');
    };

    if (selectRecordNow(serverId)) {
      returnToHome(true);
      return () => {
        active = false;
        if (!committed && homeWorkspaceHandoffStore.getState().handoff?.id === handoffId)
          homeWorkspaceHandoffStore.getState().clear();
      };
    }

    void selectRecord(serverId)
      .then(returnToHome)
      .catch(() => returnToHome(false));
    return () => {
      active = false;
      if (!committed && homeWorkspaceHandoffStore.getState().handoff?.id === handoffId)
        homeWorkspaceHandoffStore.getState().clear();
    };
  }, [
    paneId,
    routeMode,
    rootOwnerServerId,
    router,
    selectRecord,
    selectRecordNow,
    serverId,
    sessionId,
    tabId,
    workspaceId,
  ]);

  if (routeMode === 'root-handoff') {
    return transferState === 'missing' ? <RouteTargetUnavailable /> : <RouteTransferLoading />;
  }

  return (
    <ServerTerminalWorkspace
      routeBound
      sessionId={sessionId}
      workspaceId={workspaceId}
      tabId={tabId}
      paneId={paneId}
    />
  );
}

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function RouteTargetUnavailable() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <AppDrawer>
      <View style={styles.missing}>
        <Text variant="heading">{t`Server not found`}</Text>
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {t`Return to the server list and pair again.`}
        </Text>
      </View>
    </AppDrawer>
  );
}

function RouteTransferLoading() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <AppDrawer>
      <View style={styles.loading}>
        <Spinner size="sm" color={theme.colors.textMuted} />
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {t`Loading servers`}
        </Text>
      </View>
    </AppDrawer>
  );
}

const styles = StyleSheet.create({
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
});
