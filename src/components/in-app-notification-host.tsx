import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { router, type Href } from 'expo-router';
import { Bell, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appChrome } from '@/constants/appearance';
import { fadeInDown } from '@/lib/motion';
import { useAppSettings } from '@/stores/app-settings';
import { useInAppNotifications } from '@/stores/in-app-notifications';

import { PressableScale } from './pressable-scale';

/** Mounted inside AppLockGate: neither contents nor actions cross the lock. */
export function InAppNotificationHost() {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const enabled = useAppSettings((state) => state.notificationsEnabled);
  const items = useInAppNotifications((state) => state.items);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active')
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!enabled) useInAppNotifications.getState().clear();
  }, [enabled]);
  const notice = items[0];
  if (!enabled || !active || !notice) return null;
  const dismiss = () => useInAppNotifications.getState().dismiss(notice.id);
  const open = () => {
    if (!notice.route) return;
    router.navigate(notice.route as Href);
    dismiss();
  };
  return (
    <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        key={notice.id}
        entering={fadeInDown('short')}
        style={[
          styles.card,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
          },
        ]}
        testID="in-app-notification">
        <View style={[styles.icon, { backgroundColor: colors.primarySubtle }]}>
          <Bell size={18} color={colors.primary} />
        </View>
        <View style={styles.content} accessibilityLiveRegion="polite">
          <Text variant="label" numberOfLines={2}>
            {notice.title || t`Muqun`}
          </Text>
          {notice.body ? (
            <Text selectable variant="bodySmall" color={colors.textMuted} numberOfLines={4}>
              {notice.body}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {notice.route ? (
              <PressableScale
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={t`Open`}
                testID="in-app-notification-open"
                style={styles.action}>
                <Text variant="label" color={colors.primary}>{t`Open`}</Text>
              </PressableScale>
            ) : null}
            {items.length > 1 ? (
              <Text variant="caption" color={colors.textMuted} style={styles.count}>
                {items.length}
              </Text>
            ) : null}
          </View>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Close`}
          onPress={dismiss}
          testID="in-app-notification-dismiss"
          style={styles.close}>
          <X size={18} color={colors.textMuted} />
        </PressableScale>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
    flexDirection: 'row',
    gap: 10,
    boxShadow: appChrome.shadow.notice,
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0, gap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  count: { fontVariant: ['tabular-nums'] },
});
