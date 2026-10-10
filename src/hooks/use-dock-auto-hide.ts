import { useEffect } from 'react';
import {
  useReducedMotion,
  useSharedValue,
  withTiming,
  type ScrollEvent,
  type SharedValue,
} from 'react-native-reanimated';

import { dockScrollStep } from '@/lib/dock-auto-hide';
import { timing } from '@/lib/motion';

/** What the dock reads: how far it is slid down, and how to keep it shown. */
export interface DockAutoHide {
  offset: SharedValue<number>;
  /** Shown and held there while true: a focused field, the keyboard, a send. */
  setPinned: (pinned: boolean) => void;
}

/**
 * The dock's hide-on-scroll state, for the scroll view whose list it floats
 * over. `scroll` runs in that view's animated scroll handler on the UI thread;
 * `beginDrag`/`endDrag` run once per gesture from its JS drag events. The
 * per-event decision is `dockScrollStep`.
 *
 * `distance`: how far the dock slides to be out of view, its measured height.
 */
export function useDockAutoHide(distance: number) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const hidden = useSharedValue(false);
  const pinned = useSharedValue(false);
  const dragging = useSharedValue(false);
  const travel = useSharedValue(0);
  const lastY = useSharedValue(0);
  const distanceValue = useSharedValue(distance);
  useEffect(() => {
    distanceValue.set(distance);
  }, [distance, distanceValue]);

  const scroll = (event: ScrollEvent) => {
    'worklet';
    const y = event.contentOffset.y;
    const step = dockScrollStep(
      {
        y,
        delta: y - lastY.get(),
        contentHeight: event.contentSize.height,
        viewportHeight: event.layoutMeasurement.height,
        dragging: dragging.get(),
        pinned: pinned.get(),
      },
      { travel: travel.get(), offset: offset.get(), distance: distanceValue.get() }
    );
    lastY.set(y);
    travel.set(step.travel);
    if (step.kind === 'show') {
      if (!hidden.get()) return;
      hidden.set(false);
      offset.set(reduceMotion ? 0 : withTiming(0, timing('short')));
    } else if (step.kind === 'follow') {
      hidden.set(true);
      offset.set(reduceMotion ? distanceValue.get() : step.offset);
    }
  };
  const beginDrag = () => {
    dragging.set(true);
  };
  /** The finger lifted: a dock already on its way out finishes leaving. */
  const endDrag = () => {
    dragging.set(false);
    if (!hidden.get()) return;
    const out = distanceValue.get();
    offset.set(reduceMotion ? out : withTiming(out, timing('medium')));
  };
  const setPinned = (next: boolean) => {
    pinned.set(next);
    if (!next || !hidden.get()) return;
    hidden.set(false);
    offset.set(reduceMotion ? 0 : withTiming(0, timing('short')));
  };
  const dock: DockAutoHide = { offset, setPinned };
  return { dock, scroll, beginDrag, endDrag };
}
