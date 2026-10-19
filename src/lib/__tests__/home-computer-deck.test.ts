import { describe, expect, test } from 'bun:test';

import {
  DECK_STALL_MS,
  deckCommits,
  deckMoved,
  deckOrder,
  deckSwipeMove,
  deckWatch,
} from '@/lib/home-computer-deck';

describe('home computer deck', () => {
  test('a left swipe sends the front to the back; a right swipe or a peek brings one forward', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(deckMoved(order, deckSwipeMove(-1, 4))).toEqual(['b', 'c', 'd', 'a']);
    expect(deckMoved(order, deckSwipeMove(1, 4))).toEqual(['d', 'a', 'b', 'c']);
    expect(deckMoved(order, 2)).toEqual(['c', 'a', 'b', 'd']);
    // The order survives cards coming and going; the remembered front leads at first.
    expect(deckOrder(null, ['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(deckOrder(['c', 'a', 'b'], ['a', 'b', 'e'])).toEqual(['a', 'b', 'e']);
  });

  test('a release commits past the distance or on a flick that way, never on a flick back', () => {
    const width = 360;
    expect(deckCommits(-0.36 * width, 0, width, -1)).toBe(true);
    expect(deckCommits(-24, -200, width, -1)).toBe(false);
    expect(deckCommits(-40, -900, width, -1)).toBe(true);
    expect(deckCommits(-0.5 * width, 900, width, -1)).toBe(false);
    expect(deckCommits(0.4 * width, 0, width, 1)).toBe(true);
    expect(deckCommits(-50, 0, 1200, -1)).toBe(true);
    expect(deckCommits(-20, -550, width, -1)).toBe(true);
    expect(deckCommits(-5, -550, width, -1)).toBe(false);
  });

  test('the watchdog gives up a move only once it has stood still, finger up, past the limit', () => {
    const look = { engaged: true, holding: false, sample: '7|0.76|0' };
    const first = deckWatch(null, look, 1000);
    expect(first.stalled).toBe(false);
    // Any change in the move starts the wait again.
    const moving = deckWatch(first.watch, { ...look, sample: '7|0.8|0' }, 1000 + DECK_STALL_MS);
    expect(moving).toEqual({
      watch: { sample: '7|0.8|0', sinceMs: 1000 + DECK_STALL_MS },
      stalled: false,
    });
    expect(
      deckWatch(moving.watch, { ...look, sample: '7|0.8|0' }, 999 + 2 * DECK_STALL_MS).stalled
    ).toBe(false);
    expect(
      deckWatch(moving.watch, { ...look, sample: '7|0.8|0' }, 1000 + 2 * DECK_STALL_MS)
    ).toEqual({
      watch: null,
      stalled: true,
    });
    // A resting finger, or a deck at rest, is never stuck.
    expect(deckWatch(first.watch, { ...look, holding: true }, 1e9)).toEqual({
      watch: null,
      stalled: false,
    });
    expect(deckWatch(first.watch, { ...look, engaged: false }, 1e9)).toEqual({
      watch: null,
      stalled: false,
    });
  });
});
