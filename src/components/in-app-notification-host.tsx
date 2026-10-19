import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { surfaceBackgroundFill } from '@/theme/surface-background';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { router, usePathname, type Href } from 'expo-router';
import { NotificationsIcon, NextIcon } from '@/icons';
import { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useKeyboardState } from 'react-native-keyboard-controller';
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
import { appChrome } from '@/constants/appearance';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { permissionActionPhrase } from '@/i18n/labels';
import { readApprovalBody } from '@/lib/agent-engine-text';
import { feedback } from '@/lib/feedback';
import {
  noticeAutoDismissDelay,
  noticePresentationAllowed,
  noticeDisplayTitle,
  type InAppNotice,
} from '@/lib/in-app-notifications';
import { fadeInDown, settleTo, timing } from '@/lib/motion';
import { noticeDragOffset, noticeSwipeEnd } from '@/lib/notice-swipe';
import { AGENT_TYPE } from '@/constants/agent-type';
import { useAppSettings } from '@/stores/app-settings';
import { useInAppNotifications } from '@/stores/in-app-notifications';

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
 * The foreground notification banner: one readable plate and a compact action row.
 *
 * What it says is the gateway's; how it reads is the app's. A push arrives as
 * a title and a body, and the banner draws them the way the rest of Muqun
 * draws a thing and its provenance -- "Agent done" in the app's ink and "desk"
 * muted behind it, with the sentence underneath and room for either to wrap.
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
  const backPageClipStyle = useNotificationSurfaceStyle(false);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const [contentHeight, setContentHeight] = useState(0);
  // Bound the whole card, including wrapped controls. The keyboard already
  // covers the bottom safe area; do not subtract that inset twice.
  const availableHeight = Math.max(
    0,
    height - insets.top - NOTICE_TOP_GAP - 8 - Math.max(keyboardHeight, insets.bottom) - 6
  );
  const contentLimit = Math.min(height * 0.45, availableHeight);
  const scrollable = contentHeight > contentLimit;
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const { colors } = useThemeTokens();
  const mono = useMonoFontFamily();
  const enabled = useAppSettings((state) => state.notificationsEnabled);
  const pathname = usePathname();
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const position = selectedIndex < 0 ? 0 : selectedIndex;
  const notice = items[position];
  // If even one touch target cannot fit below navigation, defer the banner
  // without consuming it or its lifetime. Closing the keyboard restores it.
  const visible = Boolean(
    enabled && active && notice && contentLimit >= 44 && noticePresentationAllowed(pathname)
  );

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
  const gestureNoticeId = useSharedValue('');
  const expanded = expandedId === noticeId;
  const autoDismissDelay = noticeAutoDismissDelay(notice?.kind, visible && !expanded);
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
    dragOpacity.set(1);
    gestureNoticeId.set(noticeId);
    dismissing.set(false);
    dragX.set(0);
    dragY.set(0);
  }, [noticeId, dragX, dragY, dragOpacity, dismissing, gestureNoticeId]);
  useEffect(
    () => () => {
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      cancelAnimation(dragOpacity);
    },
    [dragX, dragY, dragOpacity]
  );

  const dragStyle = useAnimatedStyle(() => ({
    opacity: dragOpacity.get(),
    transform: [{ translateX: dragX.get() }, { translateY: dragY.get() }],
  }));

  const backSizeStyle = useAnimatedStyle(() => ({
    height: plateHeight.get(),
    opacity: plateHeight.get() > 0 ? 1 : 0,
  }));

  const dismiss = useStableHandler((id: string) => {
    if (id === notice?.id) setSelectedId(items[(position + 1) % items.length]?.id ?? null);
    useInAppNotifications.getState().dismiss(id);
  });
  // Dismiss the card captured by this gesture, even if new notices arrive.
  const swept = useStableHandler((id: string) => {
    void feedback('selection');
    dismiss(id);
  });
  const clearAll = () => {
    gestureNoticeId.set('');
    cancelAnimation(dragX);
    cancelAnimation(dragY);
    cancelAnimation(dragOpacity);
    setSelectedId(null);
    setExpandedId(null);
    useInAppNotifications.getState().clear();
  };

  /*
    Sideways either way, upward only, and nothing at all downward: the deck's
    waiting pages peek out below the plate and a downward stroke is how the
    reader reaches past it. `failOffsetY` is what makes that a refusal rather
    than a dead zone -- the gesture gives the touch up, so whatever is under
    the plate can have it.
  */
  const swipe = useMemo(() => {
    const pan = Gesture.Pan().activeOffsetX([-DRAG_SLOP, DRAG_SLOP]);
    // A long notice owns vertical scrolling. Sideways dismissal remains
    // available; short cards also keep their familiar upward dismissal.
    if (scrollable) pan.failOffsetY([-DRAG_SLOP, DRAG_SLOP]);
    else pan.activeOffsetY(-DRAG_SLOP).failOffsetY(DRAG_SLOP);
    return pan
      .onUpdate((event) => {
        'worklet';
        if (dismissing.get() || gestureNoticeId.get() !== noticeId) return;
        const offset = noticeDragOffset(event);
        dragX.set(offset.x);
        dragY.set(offset.y);
      })
      .onEnd((event, success) => {
        'worklet';
        if (dismissing.get() || gestureNoticeId.get() !== noticeId) return;
        // Native cancellation also calls onEnd; it must never dismiss a notice.
        const end = success ? noticeSwipeEnd(event) : { dismissed: false as const };
        if (!end.dismissed) {
          // An ordinary release carries the finger's velocity into the landing;
          // a cancellation returns to rest without inferring a flick.
          settleTo(dragX, 0, success ? event.velocityX : 0);
          settleTo(dragY, 0, success ? event.velocityY : 0);
          return;
        }
        // A short glide and fade replaces the full-screen throw. Ignore release
        // velocity here so a fast flick cannot launch the card into the status bar.
        dismissing.set(true);
        const config = timing('short');
        dragX.set(withTiming(end.x, config));
        dragY.set(withTiming(end.y, config));
        dragOpacity.set(
          withTiming(0, config, (finished) => {
            if (finished) runOnJS(swept)(noticeId);
          })
        );
      });
  }, [dismissing, dragX, dragY, dragOpacity, swept, scrollable, noticeId, gestureNoticeId]);

  if (!visible || !notice) return null;

  /** How many notices are waiting behind this one. */
  const waiting = items.length - 1;
  const open = () => {
    if (!notice.route) return;
    router.navigate(notice.route as Href);
    dismiss(notice.id);
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'dismiss') dismiss(notice.id);
  };
  const dismissAction = [{ name: 'dismiss', label: t`Dismiss` }];

  const renderCard = (entry: InAppNotice) => {
    /*
    An approval is the one notice the app can say better than the gateway can.
    The push arrives titled "APPROVAL REQUIRED" -- a sign, not a sentence --
    with a body of `external_directory: /etc/*`, which is the rule key the
    permission card already translates. Same words here as on the card.
  */
    // A question shares the approval's persistence, not its words.
    const approval =
      entry.kind === 'approval' && !entry.question ? readApprovalBody(entry.body) : null;
    const approvalPhrase =
      approval && approval.action && permissionActionPhrase[approval.action]
        ? _(permissionActionPhrase[approval.action]!)
        : '';
    const { lead, suffix } = noticeDisplayTitle(entry, {
      question: t`Needs your input`,
      approval: t`Approval required`,
      fallback: t`Muqun`,
    });
    // Full prose and unfamiliar action keys remain available in Details. Only a
    // known phrase can replace the action while showing its subject separately.
    const body = approvalPhrase || entry.body;
    const detail = approvalPhrase ? approval?.subject : '';
    return (
      <Animated.View
        key={entry.id}
        entering={fadeInDown('short')}
        accessibilityLiveRegion="polite"
        onLayout={(event) => plateHeight.set(event.nativeEvent.layout.height)}
        // The reader's opacity, but never thinner than the chrome floor. A
        // notice floats over whatever screen is up -- header buttons, a
        // transcript, the pages waiting behind it -- and a plate at the bare
        // slider let all of that show through its text. It is read for two
        // seconds; it has to be readable for all of them.
        style={[
          styles.card,
          notificationSurfaceStyle,
          {
            backgroundColor: surfaceBackgroundFill(
              colors.surfaceRaised,
              Math.max(surfaceOpacity, appChrome.opacity.glassSolidFloor)
            ),
          },
        ]}
        testID="in-app-notification">
        <ScrollView
          testID="in-app-notification-content"
          style={{ maxHeight: contentLimit }}
          contentContainerStyle={styles.cardContent}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={scrollable}
          onContentSizeChange={(_width, content) => setContentHeight(content)}>
          <View
            style={styles.content}
            accessible
            accessibilityActions={dismissAction}
            onAccessibilityAction={onAccessibilityAction}>
            <View style={styles.heading}>
              <NotificationsIcon size={18} color={colors.primary} style={styles.glyph} />
              <Text
                numberOfLines={expanded ? undefined : 2}
                variant="bodySmall"
                weight="semibold"
                style={styles.title}>
                {lead}
                {suffix ? (
                  <Text variant="bodySmall" color={colors.textMuted}>
                    {' \u00b7 '}
                    {suffix}
                  </Text>
                ) : null}
              </Text>
            </View>
            {body ? (
              <Text
                numberOfLines={expanded ? undefined : 2}
                selectable
                variant="caption"
                color={colors.textMuted}>
                {body}
              </Text>
            ) : null}
            {/* The path or the command, once, in the face the card gives
                    it: an approval that does not name its subject is not an
                    approval the reader can answer. */}
            {detail ? (
              <Text
                numberOfLines={expanded ? undefined : 2}
                selectable
                color={colors.text}
                style={[styles.detail, { fontFamily: mono }]}>
                {detail}
              </Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            {waiting > 0 ? (
              <PressableScale
                testID="in-app-notification-next"
                accessibilityRole="button"
                onPress={() => setSelectedId(items[(position + 1) % items.length]!.id)}
                style={[styles.counter, { borderRadius: profile.chrome.control }]}
                accessibilityValue={{ text: `${position + 1} / ${items.length}` }}
                accessibilityLabel={t`Next notification`}>
                <Text variant="caption" color={colors.textMuted} style={styles.count}>
                  {position + 1} / {items.length}
                </Text>
                <NextIcon size={12} color={colors.textMuted} />
              </PressableScale>
            ) : null}
            <PressableScale
              testID="in-app-notification-clear-all"
              accessibilityRole="button"
              accessibilityLabel={t`Clear all`}
              accessibilityHint={t`Clears notifications only. Pending tasks still need your attention.`}
              onPress={clearAll}
              style={[styles.counter, { borderRadius: profile.chrome.control }]}>
              <Text variant="caption" color={colors.textMuted}>
                {t`Clear all`}
              </Text>
            </PressableScale>
            <PressableScale
              testID="in-app-notification-details"
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={expanded ? t`Show less` : t`Show details`}
              onPress={() => setExpandedId(expanded ? null : entry.id)}
              style={[styles.counter, { borderRadius: profile.chrome.control }]}>
              <Text variant="caption" color={colors.textMuted}>
                {expanded ? t`Show less` : t`Details`}
              </Text>
            </PressableScale>
            {entry.route ? (
              <PressableScale
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={t`Open`}
                accessibilityActions={dismissAction}
                onAccessibilityAction={onAccessibilityAction}
                testID="in-app-notification-open"
                style={[styles.action, { borderRadius: profile.chrome.control }]}>
                {/* Sentence case, and `caption` rather than the kit's
                        `label`: `label` is uppercase, and this is a word the
                        reader is asked to read, not a sign. */}
                <Text variant="caption" weight="semibold" color={colors.primary}>
                  {t`Open`}
                </Text>
              </PressableScale>
            ) : null}
          </View>
        </ScrollView>
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
                // Only a quiet page edge: no duplicate content or shadow
                // beneath the translucent front card.
                backPageClipStyle,
                backSizeStyle,
                {
                  backgroundColor: surfaceBackgroundFill(
                    colors.surfaceRaised,
                    depth === 1 ? 0.7 : 0.4
                  ),
                  borderColor: surfaceBackgroundFill(colors.border, 0.35),
                  transform: [{ translateY: depth * 3 }, { scaleX: 1 - depth * 0.025 }],
                },
              ]}
              testID="in-app-notification-back"
            />
          ) : null
        )}
        <GestureDetector gesture={swipe}>
          <Animated.View style={dragStyle}>{renderCard(notice)}</Animated.View>
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
  deck: { width: '100%', maxWidth: 480, marginTop: 8 },
  backPage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    width: '100%',
    maxWidth: 480,
  },
  cardContent: {
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 12,
    gap: 2,
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  glyph: { marginTop: 1 },
  title: { flex: 1, minWidth: 0 },
  content: { minWidth: 0, gap: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    maxWidth: '100%',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    maxWidth: '100%',
    marginLeft: 'auto',
  },
  count: { fontVariant: ['tabular-nums'] },
  // The approval's subject: a path or a command, and the part of the
  // banner the reader has to read character for character before they can
  // answer it. The literal `'monospace'` it used to name meant this line alone
  // stayed on the platform face while the permission card it mirrors moved to
  // the reader's. The family is merged in at the render site.
  detail: {
    fontSize: AGENT_TYPE.meta.size,
    lineHeight: AGENT_TYPE.meta.lineHeight,
  },
});
