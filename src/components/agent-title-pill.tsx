import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale } from '@/components/pressable-scale';
import { feedback } from '@/lib/feedback';
import { INSTANT, settleTo, timing } from '@/lib/motion';
import {
  canSwipeSessions,
  neighbourSession,
  SESSION_SWIPE,
  sessionNeighbours,
  sessionSwipeActionDirection,
  sessionSwipeDirection,
  sessionSwipeFollow,
  type SessionSwipeDirection,
} from '@/lib/session-swipe';
import { useAgentSessionState } from '@/stores/agent-session-state';
import { useStableHandler } from '@/hooks/use-render-refs';

/**
 * The agent header's title pill, with a horizontal swipe on it switching to the
 * adjacent session.
 *
 * The gesture is bound to this pill and nothing else. A two-finger swipe on the
 * transcript was considered and rejected: the content below is a reading
 * surface, and a gesture that changes what you are reading should be made on
 * the thing that names it. The pill already is that thing -- it says which
 * session is on screen, and tapping it opens the list of them -- so a swipe
 * here has exactly one possible meaning.
 *
 * What the pill does *not* do is own the switch. A commit calls the strip's own
 * handler, so a swipe and a tap on a chip are the same act: one selection
 * change, after which the header, the strip, the snapshot load and the
 * transcript's own entrance all follow as they already do. There is no second
 * transition layered on top of that one -- this component animates the title,
 * and stops at the edge of the pill.
 */

/** Half the carousel: the title goes out this far, then in from the other side. */
const SLIDE_DISTANCE = 16;

/**
 * How quiet the edge marks are.
 *
 * They exist to answer "is there anything that way", asked by someone who has
 * not thought to ask it. At full strength they would be a control, and the pill
 * already has one of those; at 30% of the subtlest text colour in the system
 * they are a texture you notice only once you are looking for it. The first
 * swipe is its own tutorial, so there is nothing else: no toast, no coach mark,
 * no badge that has to be dismissed.
 */
const MARK_OPACITY = 0.3;

/** Three dots, stacked vertically, per side. */
const MARK_DOTS = [0, 1, 2];

type AgentTitlePillProps = {
  /** The pill's older job, unchanged: it opens whatever it is showing. */
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * One side's mark, fading with whether there is a session behind it.
 *
 * Mounted either way and animated on opacity rather than mounted and unmounted:
 * at the end of the list the mark on that side has to *leave*, and a mark that
 * vanishes between two frames reads as a glitch on a surface this quiet.
 */
function EdgeMark({ side, present }: { side: 'left' | 'right'; present: boolean }) {
  const theme = useThemeTokens();
  const shown = useSharedValue(present ? MARK_OPACITY : 0);

  useEffect(() => {
    shown.set(withTiming(present ? MARK_OPACITY : 0, timing('short')));
  }, [present, shown]);

  const style = useAnimatedStyle(() => ({ opacity: shown.get() }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.mark, side === 'left' ? styles.markLeft : styles.markRight, style]}>
      {MARK_DOTS.map((dot) => (
        <View key={dot} style={[styles.markDot, { backgroundColor: theme.colors.textSubtle }]} />
      ))}
    </Animated.View>
  );
}

export function AgentTitlePill({
  onPress,
  accessibilityLabel,
  testID,
  style,
  children,
}: AgentTitlePillProps) {
  const { t } = useLingui();
  const reduceMotion = useReducedMotion();
  const sessionOrder = useAgentSessionState((s) => s.sessionOrder);
  const activeAsid = useAgentSessionState((s) => s.activeAsid);
  const switching = useAgentSessionState((s) => s.switching);
  const switchSession = useAgentSessionState((s) => s.switchSession);

  const enabled = canSwipeSessions(sessionOrder);
  const neighbours = useMemo(
    () => sessionNeighbours(sessionOrder, activeAsid),
    [sessionOrder, activeAsid]
  );

  const slide = useSharedValue(0);
  const fade = useSharedValue(1);
  /**
   * The pill's measured width, for the clamp on how far the title may travel.
   * A shared value, because the clamp is applied on the UI thread while the
   * finger is down and reading a piece of React state from there is not a thing
   * that can be done.
   */
  const pillWidth = useSharedValue(0);
  const [measured, setMeasured] = useState(0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      pillWidth.set(width);
      setMeasured(width);
    },
    [pillWidth]
  );

  /**
   * The cross-fade, composed from the two presets the terminal's title switcher
   * established: out on `dropdown`, the shorter one, then in on `short`.
   *
   * The title that is leaving clears *before* the one arriving commits. A
   * symmetric cross-fade would show both at half strength through the middle,
   * which reads as two titles trading places rather than as one pill changing
   * what it says -- the same rule the header's other two morphs follow.
   *
   * Written as one sequence per value rather than as a completion callback:
   * assigning a shared value from inside its own callback cancels the animation
   * that is calling it, which calls it again, and the UI thread recurses until
   * it dies.
   *
   * With reduce motion on, the slide is not merely shortened, it is not
   * composed at all -- the value is left where it is and only the opacity pair
   * runs. `timing` already carries `ReduceMotion.System`, which stops an
   * animation; it cannot know that of these two properties one is the meaning
   * and the other is the decoration.
   */
  const playSwitch = useCallback(
    (direction: SessionSwipeDirection) => {
      const out = timing('dropdown');
      const back = timing('short');
      fade.set(withSequence(withTiming(0, out), withTiming(1, back)));
      if (reduceMotion) {
        slide.set(withTiming(0, out));
        return;
      }
      const away = direction === 'next' ? -SLIDE_DISTANCE : SLIDE_DISTANCE;
      slide.set(
        withSequence(
          withTiming(away, out),
          // The jump to the far side happens while the title is invisible.
          withTiming(-away, INSTANT),
          withTiming(0, back)
        )
      );
    },
    [fade, reduceMotion, slide]
  );

  /**
   * A committed swipe, from the gesture or from a screen reader's action.
   *
   * Switching is always allowed -- what a session has queued or is steering
   * belongs to that session, and holding the reader on it until it finishes
   * would make a busy agent a trap. A commit *during a snapshot load* is
   * dropped, though: the screen is already fetching a transcript, and a second
   * destination handed to it half a second later is two loads for one answer.
   */
  const commit = useCallback(
    (direction: SessionSwipeDirection) => {
      const target = neighbourSession(sessionOrder, activeAsid, direction);
      if (!target || !switchSession) return;
      if (switching) return;
      playSwitch(direction);
      void feedback('selection');
      switchSession(target);
    },
    [activeAsid, playSwitch, sessionOrder, switchSession, switching]
  );

  // The gesture reaches `commit` through a stable handler and is therefore built once.
  // Rebuilding it every render -- which is what a bare `Gesture.Pan()` in the
  // body does -- drops and re-registers the native handler on every state
  // change, including the ones a switch itself causes.
  const commitFromGesture = useStableHandler(commit);

  // Read on the UI thread while the finger is down, so the drag can resist in
  // the direction that has nothing behind it without a round trip to JS.
  const hasPrevious = useSharedValue(false);
  const hasNext = useSharedValue(false);
  useEffect(() => {
    hasPrevious.set(neighbours.previous !== undefined);
    hasNext.set(neighbours.next !== undefined);
  }, [hasNext, hasPrevious, neighbours]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        // Committed to only once the drag is clearly sideways. The transcript
        // scrolls directly underneath this pill, so a vertical drag has to
        // reach it: past `failOffsetY` the recogniser fails outright and the
        // touch is the list's. A tap -- the pill's other job -- never travels
        // far enough to start a pan at all.
        .activeOffsetX([...SESSION_SWIPE.activeOffsetX])
        .failOffsetY([...SESSION_SWIPE.failOffsetY])
        .onUpdate((event) => {
          // The title follows the finger, damped and clamped. Without it a
          // swipe is a command rather than a drag: no sign the gesture was
          // recognised, no sense of how far it has to go, and nothing to
          // abandon by dragging back.
          const forward = event.translationX < 0;
          const available = forward ? hasNext.get() : hasPrevious.get();
          slide.set(sessionSwipeFollow(event.translationX, pillWidth.get(), available));
        })
        // `commitFromGesture` never changes identity and always reaches the
        // newest `commit` (see `useStableHandler`), which is what keeps the
        // gesture built once instead of re-registered on every state change.
        .onEnd((event) => {
          const direction = sessionSwipeDirection(
            event.translationX,
            event.translationY,
            event.velocityX
          );
          const available = direction === 'next' ? hasNext.get() : hasPrevious.get();
          if (direction && available) {
            // `playSwitch` puts the title where the carousel wants it, so the
            // drag's own offset is cleared here rather than settled.
            slide.set(0);
            scheduleOnRN(commitFromGesture, direction);
            return;
          }
          // Not a swipe, or the end of the list: the title goes back where it
          // was, carrying the throw's own velocity into its rest rather than
          // being picked up and put down by the app.
          settleTo(slide, 0, event.velocityX * SESSION_SWIPE.followRatio);
        })
        // A gesture the system takes away -- a navigation pop, another
        // recogniser winning -- still has to put the title back.
        .onFinalize((_event, success) => {
          if (!success) slide.set(withTiming(0, timing('short')));
        }),
    [commitFromGesture, enabled, hasNext, hasPrevious, pillWidth, slide]
  );

  const titleStyle = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateX: slide.get() }],
  }));

  const accessibilityActions = useMemo(
    () =>
      enabled
        ? [
            { name: 'increment', label: t`Next session` },
            { name: 'decrement', label: t`Previous session` },
          ]
        : undefined,
    [enabled, t]
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const direction = sessionSwipeActionDirection(event.nativeEvent.actionName);
      if (direction) commit(direction);
    },
    [commit]
  );

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        {/* A plain view for the detector to attach to, so the gesture does not
            depend on what the pressable happens to render into. */}
        <View collapsable={false}>
          <PressableScale
            testID={testID}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={enabled ? t`Swipe left or right to switch session` : undefined}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={enabled ? onAccessibilityAction : undefined}
            style={style}>
            <Animated.View style={[styles.title, titleStyle]}>{children}</Animated.View>
          </PressableScale>
        </View>
      </GestureDetector>
      {/* Drawn over the title rather than beside it: the pill is a fixed slot
          in the header and the marks must not take width from the name. They
          are only ever drawn when the pill is wide enough to have edges to
          spare. */}
      {enabled && measured > 0 ? (
        <>
          <EdgeMark side="left" present={neighbours.previous !== undefined} />
          <EdgeMark side="right" present={neighbours.next !== undefined} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    // The pill's content is drawn as two absolutely-positioned layers that
    // cross-fade, so it measures nothing of its own. The pressable around it
    // centres its children rather than stretching them, which leaves this
    // wrapper -- and therefore those layers -- at zero height: the pill renders
    // its icons and no name at all. Taking the pressable's height back is what
    // makes inserting a slide between the two harmless.
    height: '100%',
  },
  mark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  markLeft: { left: 2 },
  markRight: { right: 2 },
  markDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
});
