import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { router, type Href } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NAV_HEADER_CONTROL_SIZE } from '@/components/nav-header';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { permissionActionPhrase } from '@/i18n/labels';
import { readApprovalBody } from '@/lib/agent-engine-text';
import { feedback } from '@/lib/feedback';
import {
  noticeAutoDismissDelay,
  noticeTitleParts,
  type InAppNotice,
} from '@/lib/in-app-notifications';
import { fadeInDown, settleTo, timing } from '@/lib/motion';
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
const DRAG_SLOP = 6;

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
  const profile = useAppearanceProfile();
  const notificationSurfaceStyle = useNotificationSurfaceStyle();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { colors } = useThemeTokens();
  const mono = useMonoFontFamily();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const position = selectedIndex < 0 ? 0 : selectedIndex;
  const notice = items[position];
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
  const dragOpacity = useSharedValue(1);
  const dismissing = useSharedValue(false);
  /** The plate's own size, for the sideways threshold and the flight distance. */
  const plateHeight = useSharedValue(0);
  const noticeId = notice?.id ?? '';
  const autoDismissDelay = noticeAutoDismissDelay(notice?.kind, visible);
  useEffect(() => {
    if (!noticeId || autoDismissDelay === null) return;
    // Depend on the visible identity, not the queue: incoming/duplicate events
    // must not keep restarting the lifetime of the card already on screen.
    const timer = setTimeout(() => {
      useInAppNotifications.getState().dismiss(noticeId);
    }, autoDismissDelay);
    return () => clearTimeout(timer);
  }, [noticeId, autoDismissDelay]);
  useEffect(() => {
    cancelAnimation(dragX);
    cancelAnimation(dragY);
    cancelAnimation(dragOpacity);
    dragOpacity.value = 1;
    dismissing.value = false;
    dragX.value = 0;
    dragY.value = 0;
  }, [noticeId, dragX, dragY, dragOpacity, dismissing]);
  useEffect(
    () => () => {
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      cancelAnimation(dragOpacity);
    },
    [dragX, dragY, dragOpacity]
  );

  const dragStyle = useAnimatedStyle(() => ({
    opacity: dragOpacity.value,
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  const backSizeStyle = useAnimatedStyle(() => ({
    height: plateHeight.value + 8,
    opacity: plateHeight.value > 0 ? 1 : 0,
  }));

  if (!visible || !notice) return null;

  /** How many notices are waiting behind this one. */
  const waiting = items.length - 1;
  const dismiss = () => {
    setSelectedId(items[(position + 1) % items.length]?.id ?? null);
    useInAppNotifications.getState().dismiss(notice.id);
  };
  // Dismiss the card captured by this gesture, even if new notices arrive.
  const swept = () => {
    void feedback('selection');
    dismiss();
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
      if (dismissing.value) return;
      const offset = noticeDragOffset(event);
      dragX.value = offset.x;
      dragY.value = offset.y;
    })
    .onEnd((event) => {
      if (dismissing.value) return;
      const end = noticeSwipeEnd(event);
      if (!end.dismissed) {
        // Under the threshold the plate goes back where it was, carrying the
        // finger's own velocity into a critically damped landing.
        settleTo(dragX, 0, event.velocityX);
        settleTo(dragY, 0, event.velocityY);
        return;
      }
      // A short glide and fade replaces the full-screen throw. Ignore release
      // velocity here so a fast flick cannot launch the card into the status bar.
      dismissing.value = true;
      const config = timing('short');
      dragX.value = withTiming(end.x, config);
      dragY.value = withTiming(end.y, config);
      dragOpacity.value = withTiming(0, config, (finished) => {
        if (finished) runOnJS(swept)();
      });
    });

  // Render real queued content with exactly the same presentation as the front.
  const renderCard = (entry: InAppNotice, page: number, front: boolean) => {
    /*
    An approval is the one notice the app can say better than the gateway can.
    The push arrives titled "APPROVAL REQUIRED" -- a sign, not a sentence --
    with a body of `external_directory: /etc/*`, which is the rule key the
    permission card already translates. Same words here as on the card.
  */
    const approval = entry.kind === 'approval' ? readApprovalBody(entry.body) : null;
    const approvalPhrase =
      approval && approval.action && permissionActionPhrase[approval.action]
        ? _(permissionActionPhrase[approval.action]!)
        : '';
    const { lead, suffix } = noticeTitleParts(
      approval ? t`Approval required` : entry.title || t`Muqun`
    );
    // A terminal approval push is ordinary prose, not an OpenCode rule/path.
    // Keep it in the wrapping UI face instead of the single-line code detail.
    const body = approval?.action ? approvalPhrase : entry.body;
    const detail = approval?.action ? approval.subject : '';
    return (
      <Animated.View
        key={entry.id}
        entering={front ? fadeInDown('short') : undefined}
        accessibilityLiveRegion={front ? 'polite' : 'none'}
        onLayout={
          front
            ? (event) => {
                plateHeight.value = event.nativeEvent.layout.height;
              }
            : undefined
        }
        // Solid, not the theme's translucent surface. A notice floats over
        // whatever screen is up -- header buttons, a transcript, the pages
        // waiting behind it -- and a see-through plate let all of that
        // show through its text. It is read for two seconds; it has to be
        // readable for all of them.
        style={[styles.card, notificationSurfaceStyle, { backgroundColor: colors.surfaceRaised }]}
        testID={front ? 'in-app-notification' : 'in-app-notification-back'}>
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
            <Text
              selectable
              color={colors.text}
              numberOfLines={1}
              style={[styles.detail, { fontFamily: mono }]}>
              {detail}
            </Text>
          ) : null}
        </View>
        <View style={[styles.trailing, waiting > 0 ? styles.trailingStacked : null]}>
          {/* One shared card surface; the page counter turns the deck. */}
          {waiting > 0 ? (
            <PressableScale
              testID="in-app-notification-next"
              accessibilityRole="button"
              onPress={() => setSelectedId(items[(position + 1) % items.length]!.id)}
              style={[
                styles.pill,
                {
                  borderRadius: profile.chrome.control,
                  backgroundColor: surfaceBackground(colors.primarySubtle),
                },
              ]}
              accessibilityLabel={t`Next notification`}>
              <Text variant="caption" color={colors.textMuted} style={styles.count}>
                {page + 1} / {items.length}
              </Text>
            </PressableScale>
          ) : null}
          {entry.route ? (
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
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingTop: insets.top + NOTICE_TOP_GAP }]}>
      <View pointerEvents="box-none" style={styles.deck}>
        {[2, 1].map((depth) =>
          items.length > depth ? (
            <Animated.View
              key={depth}
              pointerEvents="none"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.backPage,
                backSizeStyle,
                {
                  transform: [{ translateY: depth * 6 }, { scaleX: 1 - depth * 0.035 }],
                },
              ]}>
              {renderCard(
                items[(position + depth) % items.length]!,
                (position + depth) % items.length,
                false
              )}
            </Animated.View>
          ) : null
        )}
        <GestureDetector gesture={swipe}>
          <Animated.View style={dragStyle}>{renderCard(notice, position, true)}</Animated.View>
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
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  glyph: { alignSelf: 'flex-start', marginTop: 2 },
  content: { flex: 1, minWidth: 0, gap: 3 },
  trailing: { alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  /** With a count above it, the column reads top-down: how many, then the way in. */
  trailingStacked: { alignSelf: 'stretch', justifyContent: 'space-between' },
  pill: {
    paddingHorizontal: 7,
    minHeight: 44,
    justifyContent: 'center',
  },
  action: { minHeight: 44, justifyContent: 'center', paddingLeft: 10 },
  count: { fontVariant: ['tabular-nums'] },
  // The approval's subject: a path or a command, and the one line of the
  // banner the reader has to read character for character before they can
  // answer it. The literal `'monospace'` it used to name meant this line alone
  // stayed on the platform face while the permission card it mirrors moved to
  // the reader's. The family is merged in at the render site.
  detail: {
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
