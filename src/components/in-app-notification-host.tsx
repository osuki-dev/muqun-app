import { plural } from '@lingui/core/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { router, type Href } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { appAppearanceConfig, appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { permissionActionPhrase } from '@/i18n/labels';
import { readApprovalBody } from '@/lib/agent-engine-text';
import { feedback } from '@/lib/feedback';
import { noticeTitleParts } from '@/lib/in-app-notifications';
import { fadeInDown, fadeOutUp, settleTo } from '@/lib/motion';
import { noticeDragOffset, noticeSwipeEnd } from '@/lib/notice-swipe';
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

/** The gutter either side of the plate, matching the app's other floating chrome. */
const NOTICE_SIDE_MARGIN = 16;

/**
 * Travel before the pan takes the touch, in points.
 *
 * Read twice: sideways in either direction, and upward only. There is no
 * downward entry at all, so a drag that starts by going down is never this
 * gesture -- it belongs to whatever is under the plate.
 */
const DRAG_SLOP = 12;

/**
 * The foreground notification banner: one plate, one row, one way out.
 *
 * What it says is the gateway's; how it reads is the app's. A push arrives as
 * a title and a body, and the banner draws them the way the rest of Muqun
 * draws a thing and its provenance -- "Agent done" in the app's ink and "osk"
 * muted behind it, on one line, with the sentence underneath.
 *
 * ## Why the close button went
 *
 * It was a 44pt target in the corner of a plate that is itself the size of a
 * thumb's whole reach, and it was the only way out. Every notification surface
 * the reader already knows -- iOS, Android, the lock screen -- is dismissed by
 * pushing it away, so this one is too: up and off the top, or sideways either
 * way. Downward is refused on purpose; that is where the deck's other pages
 * are, and one stroke may not mean two things. What the button leaves behind
 * is an accessibility action, because a gesture is not an affordance for a
 * reader who cannot make it.
 */
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

  /**
   * Where the plate is, as a translation off its resting place.
   *
   * Owned by the host rather than by the card, because the card is keyed by
   * the notice id and remounts when the front of the deck changes; a shared
   * value that remounted with it would lose the drag mid-stroke. The reset
   * below is the other half of that: a new notice arrives at rest, never at
   * wherever its predecessor was pushed to.
   */
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** The plate's own size, for the sideways threshold and the flight distance. */
  const plateWidth = useSharedValue(0);
  const plateHeight = useSharedValue(0);
  const noticeId = notice?.id ?? '';
  useEffect(() => {
    cancelAnimation(dragX);
    cancelAnimation(dragY);
    dragX.value = 0;
    dragY.value = 0;
  }, [noticeId, dragX, dragY]);
  useEffect(
    () => () => {
      cancelAnimation(dragX);
      cancelAnimation(dragY);
    },
    [dragX, dragY]
  );

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

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

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
  const { lead, suffix } = noticeTitleParts(
    approval ? t`Approval required` : notice.title || t`Muqun`
  );
  const body = approval ? approvalPhrase : notice.body;
  const detail = approval ? approval.subject : '';
  /** How many notices are waiting behind this one. */
  const waiting = items.length - 1;
  const dismiss = () => useInAppNotifications.getState().dismiss(notice.id);
  /**
   * The end of a flight, once the plate has actually left.
   *
   * Safe to close over this notice's id rather than re-reading the deck: the
   * queue keeps whatever is at the front stable while new events arrive behind
   * it, so between the finger lifting and the plate landing the only thing
   * that can take this notice off the front is this call itself.
   */
  const swept = () => {
    void feedback('selection');
    useInAppNotifications.getState().dismiss(notice.id);
  };
  const open = () => {
    if (!notice.route) return;
    router.navigate(notice.route as Href);
    dismiss();
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'dismiss') dismiss();
  };
  const dismissAction = [{ name: 'dismiss', label: t`Dismiss` }];

  /*
    Sideways either way, upward only, and nothing at all downward: the deck's
    waiting pages peek out below the plate and a downward stroke is how the
    reader reaches past it. `failOffsetY` is what makes that a refusal rather
    than a dead zone -- the gesture gives the touch up, so whatever is under
    the plate can have it.
  */
  const swipe = Gesture.Pan()
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .activeOffsetY(-DRAG_SLOP)
    .failOffsetY(DRAG_SLOP)
    .onUpdate((event) => {
      const offset = noticeDragOffset(event);
      dragX.value = offset.x;
      dragY.value = offset.y;
    })
    .onEnd((event) => {
      const end = noticeSwipeEnd(event, {
        width: plateWidth.value,
        height: plateHeight.value,
      });
      if (!end.dismissed) {
        // Under the threshold the plate goes back where it was, carrying the
        // finger's own velocity into a critically damped landing.
        settleTo(dragX, 0, event.velocityX);
        settleTo(dragY, 0, event.velocityY);
        return;
      }
      // Past it, the plate leaves the way it was going and the store hears
      // about it when the flight lands -- not before, or the card would be
      // unmounted out from under its own animation.
      settleTo(dragX, end.x, event.velocityX);
      settleTo(dragY, end.y, event.velocityY, (finished) => {
        if (finished) runOnJS(swept)();
      });
    });

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
                  backgroundColor: surfaceBackground(colors.surfaceRaised),
                  borderColor: colors.border,
                  transform: [{ translateY: depth * 6 }, { scaleX: 1 - depth * 0.035 }],
                },
              ]}
            />
          ) : null
        )}
        <GestureDetector gesture={swipe}>
          <Animated.View style={dragStyle}>
            <Animated.View
              key={notice.id}
              entering={fadeInDown('short')}
              exiting={fadeOutUp('short')}
              accessibilityLiveRegion="polite"
              onLayout={(event) => {
                plateWidth.value = event.nativeEvent.layout.width;
                plateHeight.value = event.nativeEvent.layout.height;
              }}
              style={[styles.card, { backgroundColor: surfaceBackground(colors.surfaceRaised) }]}
              testID="in-app-notification">
              {/* The glyph alone. A tinted circle around it is a second
                  surface on a plate that is already one surface. */}
              <Bell size={18} color={colors.primary} style={styles.glyph} />
              <View
                style={styles.content}
                accessible
                accessibilityActions={dismissAction}
                onAccessibilityAction={onAccessibilityAction}>
                <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                  {lead}
                  {suffix ? (
                    <Text variant="bodySmall" color={colors.textMuted}>
                      {' \u00b7 '}
                      {suffix}
                    </Text>
                  ) : null}
                </Text>
                {body ? (
                  <Text selectable variant="caption" color={colors.textMuted} numberOfLines={2}>
                    {body}
                  </Text>
                ) : null}
                {/* The path or the command, once, in the face the card gives
                    it: an approval that does not name its subject is not an
                    approval the reader can answer. */}
                {detail ? (
                  <Text selectable color={colors.text} numberOfLines={1} style={styles.detail}>
                    {detail}
                  </Text>
                ) : null}
              </View>
              <View style={[styles.trailing, waiting > 0 ? styles.trailingStacked : null]}>
                {/* How many are behind this one, not how many there are: the
                    plate in front is the one being read. The peeking edges
                    stop at two, so the number is what makes five honest. */}
                {waiting > 0 ? (
                  <View
                    style={[
                      styles.pill,
                      { backgroundColor: surfaceBackground(colors.primarySubtle) },
                    ]}
                    accessible
                    accessibilityLabel={t`${plural(waiting, {
                      one: '# more notification',
                      other: '# more notifications',
                    })}`}>
                    <Text variant="caption" color={colors.textMuted} style={styles.count}>
                      +{waiting}
                    </Text>
                  </View>
                ) : null}
                {notice.route ? (
                  <PressableScale
                    onPress={open}
                    accessibilityRole="button"
                    accessibilityLabel={t`Open`}
                    accessibilityActions={dismissAction}
                    onAccessibilityAction={onAccessibilityAction}
                    testID="in-app-notification-open"
                    style={styles.action}>
                    {/* Sentence case, and `caption` rather than the kit's
                        `label`: `label` is uppercase, and this is a word the
                        reader is asked to read, not a sign. */}
                    <Text variant="caption" weight="semibold" color={colors.primary}>
                      {t`Open`}
                    </Text>
                  </PressableScale>
                ) : null}
              </View>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
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
    paddingHorizontal: NOTICE_SIDE_MARGIN,
  },
  deck: { width: '100%', maxWidth: 480 },
  backPage: {
    position: 'absolute',
    top: 8,
    bottom: 0,
    left: 0,
    right: 0,
    // A hairline, not a frame: it is the only thing that tells a waiting page
    // apart from the plate standing on it, both being the same surface.
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    boxShadow: appChrome.shadow.notice,
  },
  glyph: { alignSelf: 'flex-start', marginTop: 2 },
  content: { flex: 1, minWidth: 0, gap: 3 },
  trailing: { alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  /** With a count above it, the column reads top-down: how many, then the way in. */
  trailingStacked: { alignSelf: 'stretch', justifyContent: 'space-between' },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: appAppearanceConfig.radius.pill,
  },
  action: { minHeight: 44, justifyContent: 'center', paddingLeft: 10 },
  count: { fontVariant: ['tabular-nums'] },
  detail: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
