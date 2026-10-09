/**
 * When Home's cards may re-sort (design §9): never while a finger is on the
 * page, and not until the page has been still for `SORT_SETTLE_MS` after the
 * last scroll, so nothing moves under the finger or the eye that followed it.
 *
 * Pure: `stores/home-sort-hold.ts` owns the timer and feeds `settled` back.
 */
export const SORT_SETTLE_MS = 1000;

export type SortHoldState = { touching: boolean; scrolling: boolean; settling: boolean };

export type SortHoldEvent = 'touch-start' | 'touch-end' | 'scroll-start' | 'scroll-end' | 'settled';

export const SORT_HOLD_IDLE: SortHoldState = { touching: false, scrolling: false, settling: false };

/**
 * A tap that never scrolled releases with the finger; a drag or a fling
 * releases `SORT_SETTLE_MS` after it stops. A fling that follows a drag
 * cancels the drag's settle, and its own end starts a new one.
 */
export function nextSortHold(state: SortHoldState, event: SortHoldEvent): SortHoldState {
  switch (event) {
    case 'touch-start':
      return { ...state, touching: true };
    case 'touch-end':
      return { ...state, touching: false };
    case 'scroll-start':
      return { ...state, scrolling: true, settling: false };
    case 'scroll-end':
      return { ...state, scrolling: false, settling: true };
    case 'settled':
      return { ...state, settling: false };
  }
}

export function sortHeld(state: SortHoldState): boolean {
  return state.touching || state.scrolling || state.settling;
}
