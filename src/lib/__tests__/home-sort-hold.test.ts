import { describe, expect, test } from 'bun:test';

import { nextSortHold, SORT_HOLD_IDLE, sortHeld, type SortHoldEvent } from '@/lib/home-sort-hold';

describe('nextSortHold', () => {
  // events in order -> held after each
  test.each<[string, SortHoldEvent[], boolean[]]>([
    ['a tap releases with the finger', ['touch-start', 'touch-end'], [true, false]],
    [
      'a drag holds until it has settled',
      ['touch-start', 'scroll-start', 'touch-end', 'scroll-end', 'settled'],
      [true, true, true, true, false],
    ],
    [
      'a fling after the drag cancels the drag settle',
      ['scroll-start', 'scroll-end', 'scroll-start', 'settled', 'scroll-end', 'settled'],
      [true, true, true, true, true, false],
    ],
    [
      'a finger that lands while settling keeps the hold',
      ['scroll-end', 'touch-start', 'settled', 'touch-end'],
      [true, true, true, false],
    ],
  ])('%s', (_name, events, held) => {
    let state = SORT_HOLD_IDLE;
    const seen = events.map((event) => {
      state = nextSortHold(state, event);
      return sortHeld(state);
    });
    expect(seen).toEqual(held);
  });
});
