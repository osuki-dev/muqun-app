import { create } from 'zustand';

import {
  nextSortHold,
  SORT_HOLD_IDLE,
  SORT_SETTLE_MS,
  sortHeld,
  type SortHoldEvent,
  type SortHoldState,
} from '@/lib/home-sort-hold';

type HomeSortHold = SortHoldState & {
  /** Whether the cards keep the order they are showing. */
  held: boolean;
};

/**
 * Whether Home's computer cards may re-sort now. Home's page reports touches
 * and the scroll views that hold the cards report scrolls; only the cards
 * subscribe, so a touch never re-renders Home itself.
 */
export const useHomeSortHold = create<HomeSortHold>(() => ({ ...SORT_HOLD_IDLE, held: false }));

let settleTimer: ReturnType<typeof setTimeout> | null = null;

function report(event: SortHoldEvent) {
  const { touching, scrolling, settling } = useHomeSortHold.getState();
  const next = nextSortHold({ touching, scrolling, settling }, event);
  if (event === 'scroll-start' || event === 'scroll-end') {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (next.settling && !settleTimer) {
    settleTimer = setTimeout(() => {
      settleTimer = null;
      report('settled');
    }, SORT_SETTLE_MS);
  }
  // Only `held` has subscribers, so the other fields change nothing on screen.
  useHomeSortHold.setState({ ...next, held: sortHeld(next) });
}

/**
 * Back to idle, for Home going away: a scroll view unmounted mid-drag or
 * mid-fling never reports its end.
 */
export function resetSortHold() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  useHomeSortHold.setState({ ...SORT_HOLD_IDLE, held: false });
}

/** For the page that holds the cards: any finger on it. */
export const sortHoldTouches = {
  onTouchStart: () => report('touch-start'),
  onTouchEnd: (event: { nativeEvent: { touches: readonly unknown[] } }) => {
    if (event.nativeEvent.touches.length === 0) report('touch-end');
  },
  onTouchCancel: () => report('touch-end'),
};

/** For a scroll view the cards scroll in: drags and flings. */
export const sortHoldScroll = {
  onScrollBeginDrag: () => report('scroll-start'),
  onScrollEndDrag: () => report('scroll-end'),
  onMomentumScrollBegin: () => report('scroll-start'),
  onMomentumScrollEnd: () => report('scroll-end'),
};
