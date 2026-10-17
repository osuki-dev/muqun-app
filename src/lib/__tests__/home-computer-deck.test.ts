import { describe, expect, test } from 'bun:test';

import { deckCommits, deckMoved, deckOrder, deckSwipeMove } from '@/lib/home-computer-deck';

describe('home computer deck', () => {
  test('a left swipe sends the front to the back; a right swipe or a peek brings one forward', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(deckMoved(order, deckSwipeMove(-1, 4))).toEqual(['b', 'c', 'd', 'a']);
    expect(deckMoved(order, deckSwipeMove(1, 4))).toEqual(['d', 'a', 'b', 'c']);
    expect(deckMoved(order, { kind: 'raise', level: 2 })).toEqual(['c', 'a', 'b', 'd']);
    // The order survives cards coming and going; the remembered front leads at first.
    expect(deckOrder(null, ['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(deckOrder(['c', 'a', 'b'], ['a', 'b', 'e'])).toEqual(['a', 'b', 'e']);
  });

  test('a release commits past the distance or on a flick that way, never on a flick back', () => {
    const width = 360;
    expect(deckCommits(-0.36 * width, 0, width, -1)).toBe(true);
    expect(deckCommits(-0.3 * width, -200, width, -1)).toBe(false);
    expect(deckCommits(-40, -900, width, -1)).toBe(true);
    expect(deckCommits(-0.5 * width, 900, width, -1)).toBe(false);
    expect(deckCommits(0.4 * width, 0, width, 1)).toBe(true);
  });
});
