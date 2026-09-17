import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { router, type Href } from 'expo-router';
import { Bell, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { permissionActionPhrase } from '@/i18n/labels';
import { readApprovalBody } from '@/lib/agent-engine-text';
import { fadeInDown, fadeOutUp } from '@/lib/motion';
import { AGENT_TYPE } from '@/constants/agent-type';
import { useAppSettings } from '@/stores/app-settings';
import { useInAppNotifications } from '@/stores/in-app-notifications';

import { PressableScale } from './pressable-scale';

/**
 * How far below the safe-area inset a notice starts.
 *
 * A notice used to sit on the inset itself, which is where the app's own nav
 * chrome sits: on the agent screen it landed squarely over the workspace pill
 * and the new-session control, and over a permission card's title under them.
 * The chrome's own height plus a gap is the first row a notice may occupy, so
 * it is never a lid on the controls the reader was reaching for.
 */
const NOTICE_TOP_GAP = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 10;

/** Mounted inside AppLockGate: neither contents nor actions cross the lock. */
export function InAppNotificationHost() {
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
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
  const visible = Boolean(enabled && active && notice);
  /*
    Nothing on screen takes no room. A screen that leaves space for the deck
    reads the height from the store, and a stale one would leave a hole at the
    top of a transcript with no notice in it.
  */
  useEffect(() => {
    if (!visible) useInAppNotifications.getState().setOverlayHeight(0);
  }, [visible]);
  /*
    How far down the screen the deck reaches, not how tall the card is: a
    screen leaving room for it has to clear the safe-area inset and the nav
    chrome the deck sits below as well. The outer view carries both in its
    padding, so its own height is the answer.
  */
  const measure = (event: LayoutChangeEvent) =>
    useInAppNotifications.getState().setOverlayHeight(Math.round(event.nativeEvent.layout.height));
  if (!visible || !notice) return null;

  /*
    An approval is the one notice the app can say better than the gateway can.
    The push arrives titled "APPROVAL REQUIRED" -- a sign, not a sentence --
    with a body of `external_directory: /etc/*`, which is the rule key the
    permission card already translates. Same words here as on the card.
  */
  const approval = notice.kind === 'approval' ? readApprovalBody(notice.body) : null;
  const approvalPhrase =
    approval && approval.action && permissionActionPhrase[approval.action]
      ? _(permissionActionPhrase[approval.action]!)
      : '';
  const title = approval ? t`Approval required` : notice.title || t`Muqun`;
  const body = approval ? approvalPhrase : notice.body;
  const detail = approval ? approval.subject : '';
  const dismiss = () => useInAppNotifications.getState().dismiss(notice.id);
  const open = () => {
    if (!notice.route) return;
    router.navigate(notice.route as Href);
    dismiss();
  };
  return (
    <View
      pointerEvents="box-none"
      onLayout={measure}
      style={[styles.overlay, { paddingTop: insets.top + NOTICE_TOP_GAP }]}>
      <View pointerEvents="box-none" style={styles.deck}>
        {[2, 1].map((depth) =>
          items.length > depth ? (
            <View
              key={depth}
              pointerEvents="none"
              accessible={false}
              style={[
                styles.backPage,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  transform: [{ translateY: depth * 6 }, { scaleX: 1 - depth * 0.035 }],
                },
              ]}
            />
          ) : null
        )}
        <Animated.View
          key={notice.id}
          entering={fadeInDown('short')}
          exiting={fadeOutUp('short')}
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
            },
          ]}
          testID="in-app-notification">
          <View style={[styles.icon, { backgroundColor: surfaceBackground(colors.primarySubtle) }]}>
            <Bell size={18} color={colors.primary} />
          </View>
          <View style={styles.content} accessibilityLiveRegion="polite">
            {/* `bodySmall` rather than the kit's `label`: `label` carries
                `textTransform: 'uppercase'`, and a notice shouting
                "APPROVAL REQUIRED" is a sign rather than a sentence. */}
            <Text variant="bodySmall" weight="bold" numberOfLines={2}>
              {title}
            </Text>
            {body ? (
              <Text selectable variant="bodySmall" color={colors.textMuted} numberOfLines={4}>
                {body}
              </Text>
            ) : null}
            {/* The path or the command, once, in the face the card gives it. */}
            {detail ? (
              <Text selectable color={colors.text} numberOfLines={2} style={styles.detail}>
                {detail}
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
      </View>
    </View>
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
  deck: { width: '100%', maxWidth: 480 },
  backPage: {
    position: 'absolute',
    top: 8,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: appChrome.radius.noticeBanner,
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
  detail: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
