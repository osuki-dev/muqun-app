import { useCallback, useEffect, useRef, useState } from 'react';

import { useLatestRef } from '@/hooks/use-render-refs';
import { feedback } from '@/lib/feedback';
import {
  canCycleTabs,
  cycleTabFrom,
  swipeAppliesImmediately,
  TAB_SWIPE_COMMIT_QUIET_MS,
  tabPosition,
  type CyclableTab,
  type TabCycleDirection,
  type TabCycleTarget,
} from '@/lib/tab-swipe';

/** How long the switch indicator stays up after a swipe. */
const INDICATOR_MS = 1400;

type UseTabSwipeOptions = {
  /** The tabs of the workspace currently on screen, in the order Herdr has them. */
  tabs: CyclableTab[];
  /** The tab the screen is showing, which during a burst lags the fingers. */
  tabId: string;
  /**
   * Applied by the screen, which owns the selection. Handed the tab to land on
   * rather than a direction -- during fast swiping the screen's own selection is
   * a step or more behind, and a direction would be counted from the stale one
   * -- with the direction alongside it, purely so the pane carousel travels the
   * way the fingers went.
   */
  onCycle: (target: TabCycleTarget, direction: TabCycleDirection) => void;
  /**
   * Where the swipe landed, and `null` once the announcement has run its
   * course. The pill is drawn by the screen, in the notice stack at the top --
   * see `SwitchIndicator` -- because the tab and workspace switches are one
   * object and only the screen can name a panel the way the panels sheet does.
   * The timing stays here: the target is known a beat before the screen's
   * selection catches up, and that beat is the whole reason for the indicator.
   */
  onIndicator?: (target: TabCycleTarget | null) => void;
};

export type UseTabSwipeResult = {
  /** The tab just landed on, for as long as the indicator should be up. */
  indicator: TabCycleTarget | null;
  /**
   * Handed to the canvas, which recognises the gesture. Takes a direction and
   * not a pair of touches: what a pair of fingers did is answered where they
   * are reported, by `classifyTwoFingerGesture` -- see below for why that is
   * inside the canvas and not here.
   */
  onSwipe: (direction: TabCycleDirection) => void;
};

/**
 * A two-finger swipe on the terminal, from a direction to a landed tab: the
 * transient indicator, the tick, the ring, and the settle that keeps a burst of
 * flicks down to two landings.
 *
 * What is NOT here is reading the fingers, and that is the whole lesson of this
 * gesture. This hook used to expose `onTouchStart/Move/End` for the screen to
 * spread onto the view above the canvas, and measured on an Android emulator it
 * never fired once -- nor did the two-finger pane swipe it replaced, which is
 * why nobody ever had a working demo of that one either:
 *
 *     a tap:   sample n=1 -> end remaining=0
 *     a drag:  sample n=1 -> sample n=1 -> cancel
 *
 * Gesture-handler cancels React Native's touch stream for the whole subtree the
 * instant any handler activates, and the canvas's pan activates two pixels into
 * a drag. `onTouchEnd` therefore never arrived for anything that moved, and the
 * two or three samples that did arrive before the cancel were a few pixels
 * apart -- nowhere near `TAB_SWIPE_DISTANCE`. No threshold could have rescued
 * it: the travel was never delivered at all. (Declining the pan for a second
 * pointer, `maxPointers(1)`, was tried and is worse: the canvas stops panning
 * and the drag falls through to the navigator, which goes back a screen.)
 *
 * The gesture is therefore recognised *with* gesture-handler rather than around
 * it, by a `Gesture.Pan().minPointers(2)` composed into the canvas's own
 * `Gesture.Simultaneous(panGesture, pinchGesture)` in
 * `src/components/skia-terminal.tsx`, whose touch stream reports both fingers.
 * Everything in `@/lib/tab-swipe` survived that move untouched.
 */
export function useTabSwipe({
  tabs,
  tabId,
  onCycle,
  onIndicator,
}: UseTabSwipeOptions): UseTabSwipeResult {
  const [indicator, setIndicator] = useState<TabCycleTarget | null>(null);
  const indicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Where the fingers have got to, which during fast swiping is ahead of the
  // tab the screen is showing, and which way the last swipe of the burst went.
  const pendingRef = useRef<string | null>(null);
  const pendingDirectionRef = useRef<TabCycleDirection>('next');
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSwipeAt = useRef(0);

  // Through refs, because a commit can fire a third of a second after the swipe
  // that scheduled it and must reach the screen as it is then, not as it was
  // when the timer was set.
  const onCycleRef = useRef(onCycle);
  const tabsRef = useRef(tabs);
  const tabIdRef = useRef(tabId);
  useEffect(() => {
    onCycleRef.current = onCycle;
    tabsRef.current = tabs;
    tabIdRef.current = tabId;
  }, [onCycle, tabId, tabs]);

  // Cleared only once the screen has caught up with it. Clearing on any change
  // of `tabId` looks tidier and is wrong: the first swipe of a burst is applied
  // at once, so the screen answers while later swipes are still queued, and
  // wiping the destination there loses every swipe after the first. A pending
  // tab the workspace has since closed is dropped by `cycleTabFrom` instead.
  useEffect(() => {
    if (pendingRef.current === tabId) pendingRef.current = null;
  }, [tabId]);

  // A workspace that drops to a single tab while the indicator is up should not
  // keep claiming a position that no longer exists.
  const enabled = canCycleTabs(tabs);
  useEffect(() => {
    if (enabled) return;
    if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
    setIndicator(null);
  }, [enabled]);

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

  const commit = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = undefined;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    // Re-read rather than remembered: a third of a second has passed since the
    // swipe, and a tab closed in that window must not be landed on.
    const target = tabPosition(tabsRef.current, pending);
    if (!target) return;
    onCycleRef.current(target, pendingDirectionRef.current);
  }, []);

  const swipe = useCallback(
    (direction: TabCycleDirection) => {
      const target = cycleTabFrom(tabsRef.current, tabIdRef.current, pendingRef.current, direction);
      // A workspace with one tab passes in silence: no indicator, no tick, and
      // above all no reload of a session that is already on screen.
      if (!target) return;

      void feedback('selection');
      setIndicator(target);
      if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
      indicatorTimer.current = setTimeout(() => setIndicator(null), INDICATOR_MS);

      // Every swipe is felt at once -- carousel, tick, indicator, all of them
      // above this line -- but only the destination is handed to the screen,
      // and only once the swiping stops. `swipeAppliesImmediately` is where
      // that rule and the reason for it are written down.
      const previous = lastSwipeAt.current;
      const now = Date.now();
      lastSwipeAt.current = now;
      pendingRef.current = target.tabId;
      pendingDirectionRef.current = direction;
      if (swipeAppliesImmediately(previous, now)) {
        commit();
        return;
      }
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(commit, TAB_SWIPE_COMMIT_QUIET_MS);
    },
    [commit]
  );

  return { indicator, onSwipe: swipe };
}
