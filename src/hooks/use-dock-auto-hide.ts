import { useEffect } from 'react';
import {
  useReducedMotion,
  useSharedValue,
  withTiming,
  type ScrollEvent,
  type SharedValue,
} from 'react-native-reanimated';

import { dockAtEdge, dockScrollStep } from '@/lib/dock-auto-hide';
import { timing } from '@/lib/motion';

/** What the dock reads: how far it is slid down, and how to keep it shown. */
export interface DockAutoHide {
  offset: SharedValue<number>;
  /** Shown and held there while true: a focused field, the keyboard, a send. */
  setPinned: (pinned: boolean) => void;
}

/**
 * The dock's hide-on-scroll state, for the scroll view whose list it floats
 * over. Everything here is a worklet, so the scroll view's animated handler
 * can call `scroll`, `beginDrag` and `endDrag` on the UI thread; JS calls them
 * too (the phone page's drag events, `settle` on a content or layout change,
 * `reset` when Home regains focus). The per-event decision is `dockScrollStep`.
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
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const distanceValue = useSharedValue(distance);
  useEffect(() => {
    distanceValue.set(distance);
  }, [distance, distanceValue]);

  const show = () => {
    'worklet';
    travel.set(0);
    if (!hidden.get()) return;
    hidden.set(false);
    offset.set(reduceMotion ? 0 : withTiming(0, timing('short')));
  };
  const scroll = (event: ScrollEvent) => {
    'worklet';
    const y = event.contentOffset.y;
    viewport.set(event.layoutMeasurement.height);
    content.set(event.contentSize.height);
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
    if (step.kind === 'show') {
      show();
      return;
    }
    travel.set(step.travel);
    if (step.kind === 'follow') {
      hidden.set(true);
      offset.set(reduceMotion ? distanceValue.get() : step.offset);
    }
  };
  /** A drag starts its own run: nothing scrolled before it counts. */
  const beginDrag = () => {
    'worklet';
    travel.set(0);
    dragging.set(true);
  };
  /** The finger lifted: a dock already on its way out finishes leaving. */
  const endDrag = () => {
    'worklet';
    dragging.set(false);
    if (!hidden.get()) return;
    const out = distanceValue.get();
    offset.set(reduceMotion ? out : withTiming(out, timing('medium')));
  };
  /**
   * The list's content or viewport changed without a scroll: a list that can
   * no longer scroll, or whose end has come into view, shows the dock.
   */
  const settle = (size: { contentHeight?: number; viewportHeight?: number }) => {
    'worklet';
    if (size.contentHeight !== undefined) content.set(size.contentHeight);
    if (size.viewportHeight !== undefined) viewport.set(size.viewportHeight);
    if (dockAtEdge(lastY.get(), viewport.get(), content.get())) show();
  };
  /** Home is back in front: the dock is there, whatever it was doing. */
  const reset = () => {
    'worklet';
    dragging.set(false);
    travel.set(0);
    hidden.set(false);
    offset.set(0);
  };
  const setPinned = (next: boolean) => {
    'worklet';
    pinned.set(next);
    if (next) show();
  };
  const dock: DockAutoHide = { offset, setPinned };
  return { dock, scroll, beginDrag, endDrag, settle, reset };
}
