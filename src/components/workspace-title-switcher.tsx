import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { detailTitlePillStyle, detailTitleTextStyle } from '@/components/app-drawer';
import { GlassChrome } from '@/components/glass-chrome';
import { useLatestRef } from '@/hooks/use-render-refs';
import { feedback } from '@/lib/feedback';
import { INSTANT, timing } from '@/lib/motion';
import {
  canCycleWorkspaces,
  cycleWorkspaceFrom,
  swipeDirection,
  workspaceSwitchDirection,
  type CyclableWorkspace,
  type WorkspaceCycleTarget,
} from '@/lib/workspace-cycle';

type WorkspaceTitleSwitcherProps = {
  /**
   * The header line as the screen composes it: the pane's name. The workspace
   * is named by the switch indicator in the notice stack, not here.
   */
  title: string;
  workspaces: CyclableWorkspace[];
  workspaceId: string;
  /**
   * Applied by the screen, which owns the selection. Called with the workspace
   * to land on rather than with a direction: during fast swiping the screen's
   * own selection is a step or more behind the finger, and a direction would be
   * counted from the stale one.
   */
  onCycle: (workspaceId: string) => void;
  /**
   * Where the swipe landed, and `null` once the announcement has run its
   * course. The pill itself is drawn by the screen, in the notice stack at the
   * top -- see `SwitchIndicator`. This component still owns the *timing*,
   * because the target is known here a beat before the screen's selection
   * catches up and that beat is the whole reason the indicator exists.
   */
  onIndicator?: (target: WorkspaceCycleTarget | null) => void;
};

/** How long the switch indicator stays up after a swipe. */
const INDICATOR_MS = 1400;
/**
 * How still the finger has to be before a swipe is handed to the screen.
 *
 * Long enough that a burst of flicks is one load rather than twenty -- the
 * carousel itself runs about 300 ms, so anything inside that window is still
 * mid-gesture -- and short enough that a single deliberate swipe reads as
 * instant, which it does anyway: the pill and the indicator have already moved.
 */
const COMMIT_QUIET_MS = 320;
/** Half the carousel: out this far, then in from the other side. */
const SLIDE_DISTANCE = 22;
/**
 * How much of the finger's travel the pill takes while the drag is live.
 *
 * A third. The pill is a fixed-width piece of header chrome with buttons either
 * side of it, so one-to-one tracking would put the title under them within half
 * a swipe; what the drag has to say is "this is a sideways gesture and it is
 * going that way", which a third of the distance says as clearly.
 */
const FOLLOW_RATIO = 1 / 3;

/**
 * The title pill, with a horizontal swipe on it cycling the session's
 * workspaces.
 *
 * The gesture is bound to this pill and nothing else. The screen underneath
 * carries the terminal's own pan and the pane strip, and Android's back gesture
 * lives on the screen edges -- the pill starts well inside them, behind the
 * back button -- so a swipe here can only mean one thing.
 *
 * The title itself is not swapped by hand: the screen re-renders it a beat
 * later, once the new workspace's pane is selected. The carousel therefore
 * animates the pill's own content out and back in, and the indicator -- which
 * is known immediately, before any data moves -- is what confirms the switch.
 */
export function WorkspaceTitleSwitcher({
  title,
  workspaces,
  workspaceId,
  onCycle,
  onIndicator,
}: WorkspaceTitleSwitcherProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [indicator, setIndicator] = useState<WorkspaceCycleTarget | null>(null);
  const indicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slide = useSharedValue(0);
  const fade = useSharedValue(1);
  const enabled = canCycleWorkspaces(workspaces);

  /**
   * The carousel itself, and nothing else: the current title leaves the way the
   * switch travelled and the new one arrives from the opposite edge.
   *
   * Separated from `runCycle` so that a workspace switched from somewhere other
   * than this pill can play it too. Everything `runCycle` does around it -- the
   * haptic, the indicator, the coalesced commit -- belongs to a swipe, and a
   * deep link is not one.
   *
   * Written as one sequence per value rather than as a completion callback:
   * assigning a shared value from inside its own callback cancels the animation
   * that is calling it, which calls it again, and the UI thread recurses until
   * it dies.
   */
  const playCarousel = useCallback(
    (direction: 'next' | 'previous') => {
      const away = direction === 'next' ? -SLIDE_DISTANCE : SLIDE_DISTANCE;
      // Durations come from the design system rather than from taste.
      const out = timing('dropdown');
      const back = timing('short');
      fade.value = withSequence(withTiming(0, out), withTiming(1, back));
      slide.value = withSequence(
        withTiming(away, out),
        // The jump to the far side happens while the title is invisible.
        withTiming(-away, INSTANT),
        withTiming(0, back)
      );
    },
    [fade, slide]
  );

  // Where the finger has got to, which during fast swiping is ahead of the
  // workspace the screen is showing.
  const pendingRef = useRef<string | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSwipeAt = useRef(0);
  // Through a ref, because a commit can fire a third of a second after the
  // swipe that scheduled it and must reach the screen as it is then, not as it
  // was when the timer was set.
  const onCycleRef = useRef(onCycle);
  useEffect(() => {
    onCycleRef.current = onCycle;
  }, [onCycle]);

  /**
   * The workspace the pill is currently showing the title of, so a change of
   * `workspaceId` can be told apart from a re-render of the same one.
   */
  const shownRef = useRef(workspaceId);

  // Two jobs, in one effect because their order matters.
  //
  // First: a workspace switched by anything other than this pill still has to
  // move it. The panel picker, an approval notification's deep link and the
  // gateway reconciling its own focus all change `workspaceId` from outside,
  // and the carousel used to run only from inside `runCycle` -- so every one of
  // those routes left the fade and the slide at rest and swapped the title
  // between two frames, on a component whose whole job is that the title never
  // does that.
  //
  // Then: clear the pending destination, but only once the screen has caught up
  // with it. Clearing on any change of `workspaceId` looks tidier and is wrong:
  // the first swipe of a burst is applied at once, so the screen answers while
  // later swipes are still queued, and wiping the destination there loses every
  // swipe after the first -- exactly the fault this component was fixed for. A
  // pending workspace the session has since closed is dropped by
  // `cycleWorkspaceFrom` instead.
  //
  // The order is what makes the first job possible: `pendingRef` is how this
  // component recognises its own work, and reading it after clearing it would
  // make every swipe look like an outside change and play the carousel twice.
  useEffect(() => {
    const previous = shownRef.current;
    shownRef.current = workspaceId;
    if (previous !== workspaceId && pendingRef.current !== workspaceId) {
      const direction = workspaceSwitchDirection(workspaces, previous, workspaceId);
      if (direction) playCarousel(direction);
    }
    if (pendingRef.current === workspaceId) pendingRef.current = null;
  }, [playCarousel, workspaceId, workspaces]);

  useEffect(
    () => () => {
      if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  // Through a ref so a changing callback does not re-announce a target that has
  // not moved.
  const onIndicatorRef = useLatestRef(onIndicator);
  useEffect(() => {
    onIndicatorRef.current?.(indicator);
  }, [indicator, onIndicatorRef]);

  // Nothing to switch between means nothing to announce, and a session that
  // loses a workspace while the indicator is up should not keep claiming a
  // position that no longer exists.
  useEffect(() => {
    if (enabled) return;
    if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
    setIndicator(null);
  }, [enabled]);

  const commit = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = undefined;
    }
    const target = pendingRef.current;
    if (target) onCycleRef.current(target);
  }, []);

  const runCycle = useCallback(
    (direction: 'next' | 'previous') => {
      const target = cycleWorkspaceFrom(workspaces, workspaceId, pendingRef.current, direction);
      if (!target) return;

      playCarousel(direction);

      void feedback('selection');
      setIndicator(target);
      if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
      indicatorTimer.current = setTimeout(() => setIndicator(null), INDICATOR_MS);

      // Every swipe is felt at once -- slide, tick, indicator -- but only the
      // destination is handed to the screen, and only once the swiping stops.
      //
      // Landing on a workspace is not cheap: the screen refetches the session's
      // entities, opens a fresh event stream and reads the new pane's output,
      // shortcuts and zoom. One swipe's worth of that is nothing; a finger
      // flicking every 45 ms queues them faster than they retire, and the app
      // dies of an OutOfMemoryError with the losing allocation wherever it
      // happens to land -- for us, inside Cronet's IO thread.
      //
      // So: the first swipe of a burst applies immediately, and everything
      // after it waits for the swiping to stop. A burst therefore costs two
      // loads instead of one per flick, however long it runs.
      const previous = lastSwipeAt.current;
      const now = Date.now();
      lastSwipeAt.current = now;
      pendingRef.current = target.workspaceId;
      if (now - previous >= COMMIT_QUIET_MS) {
        commit();
        return;
      }
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(commit, COMMIT_QUIET_MS);
    },
    [commit, playCarousel, workspaceId, workspaces]
  );

  // The gesture reads `runCycle` through a ref and is therefore built once.
  // Rebuilding it every render -- which is what a bare `Gesture.Pan()` in the
  // body does -- drops and re-registers the native handler on every state
  // change, including the ones a swipe itself causes.
  const runCycleRef = useRef(runCycle);
  useEffect(() => {
    runCycleRef.current = runCycle;
  }, [runCycle]);
  const cycleFromGesture = useCallback((direction: 'next' | 'previous') => {
    runCycleRef.current(direction);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        // Committed to only once the drag is clearly sideways, so a tap or a
        // vertical drag that starts on the pill is never swallowed by it.
        .activeOffsetX([-14, 14])
        .failOffsetY([-24, 24])
        .onUpdate((event) => {
          // The pill follows the finger. It used to do nothing at all until the
          // hand came off, which made a swipe a command rather than a drag:
          // there was no sign the gesture had been recognised, no sense of how
          // far it had to go, and nothing to abandon by dragging back.
          //
          // Damped to a third, and clamped to the distance the carousel itself
          // travels. This is a 200pt pill in a header, not a page: letting it
          // track the finger one-to-one would take the title clean out of the
          // chrome, and the drag is a direction being chosen, not a workspace
          // being positioned.
          const followed = event.translationX * FOLLOW_RATIO;
          slide.value = Math.max(-SLIDE_DISTANCE, Math.min(SLIDE_DISTANCE, followed));
        })
        // The handler reaches `runCycle` through the ref above, which the rule
        // reads as a ref access during render because it cannot see that
        // Gesture.Pan only ever calls this from the native gesture, never while
        // rendering. Reading the ref is the whole point: it is what keeps the
        // gesture built once instead of re-registered on every state change.
        // eslint-disable-next-line react-hooks/refs -- deliberate: see above.
        .onEnd((event) => {
          const direction = swipeDirection(
            event.translationX,
            event.translationY,
            event.velocityX
          );
          if (direction) {
            scheduleOnRN(cycleFromGesture, direction);
            return;
          }
          // Not a swipe after all: the pill goes back where it was rather than
          // being left wherever the finger abandoned it. `timing` is a worklet,
          // so it is safe to ask for a duration from in here.
          slide.value = withTiming(0, timing('short'));
        })
        // A gesture the system takes away -- a navigation pop, another
        // recogniser winning -- still has to put the pill back.
        .onFinalize((_event, success) => {
          if (!success) slide.value = withTiming(0, timing('short'));
        }),
    [cycleFromGesture, enabled, slide]
  );

  const titleAnimation = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: slide.value }],
  }));

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={gesture}>
        {/* A plain view for the detector to attach to: the glass pill is a
            platform view that varies by OS, and the gesture should not depend
            on which one this build rendered. */}
        <View collapsable={false}>
          <GlassChrome style={detailTitlePillStyle}>
            <Animated.View
              accessible
              accessibilityRole="header"
              accessibilityLabel={title}
              accessibilityHint={enabled ? t`Swipe left or right to switch workspace` : undefined}
              testID="workspace-title-switcher"
              style={[styles.titleRow, titleAnimation]}>
              <Text
                variant="bodySmall"
                numberOfLines={1}
                color={theme.colors.text}
                style={detailTitleTextStyle}>
                {title}
              </Text>
            </Animated.View>
          </GlassChrome>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
    // The pill's own carousel slides its content past the edges.
    overflow: 'visible',
  },
  titleRow: {
    width: '100%',
  },
});
