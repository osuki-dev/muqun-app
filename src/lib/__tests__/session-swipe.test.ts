// What a swipe on the agent header's title pill is allowed to do, as
// assertions.
//
// The gesture itself cannot be tested here, so everything it decides is kept
// out of the screen: which session a direction lands on, that neither end wraps
// -- the difference that separates this from the terminal's workspace ring --
// that a lone session offers nothing to swipe to, and that a drag down the
// screen is never a session switch.
import { describe, expect, test } from 'bun:test';

import {
  canSwipeSessions,
  neighbourSession,
  SESSION_SWIPE,
  sessionNeighbours,
  sessionSwipeDirection,
  sessionSwipeFollow,
} from '../session-swipe';

/** Three roots, in the order the strip draws them. */
const strip = [{ asid: 'ses_a' }, { asid: 'ses_b' }, { asid: 'ses_c' }];

describe('neighbours', () => {
  test('the middle session has one either side', () => {
    expect(sessionNeighbours(strip, 'ses_b')).toEqual({ previous: 'ses_a', next: 'ses_c' });
  });

  test('the first session has nothing before it -- the list does not wrap', () => {
    expect(sessionNeighbours(strip, 'ses_a')).toEqual({ previous: undefined, next: 'ses_b' });
  });

  test('the last session has nothing after it -- the list does not wrap', () => {
    expect(sessionNeighbours(strip, 'ses_c')).toEqual({ previous: 'ses_b', next: undefined });
  });

  test('a session the strip does not list has no neighbours at all', () => {
    // Closed under the reader, or a child of a root that is not open. Either
    // way the pill refuses rather than guessing a destination.
    expect(sessionNeighbours(strip, 'ses_gone')).toEqual({ previous: undefined, next: undefined });
  });

  test('no active session yet is the same answer', () => {
    expect(sessionNeighbours(strip, undefined)).toEqual({ previous: undefined, next: undefined });
  });

  test('a direction reads the matching side', () => {
    expect(neighbourSession(strip, 'ses_b', 'next')).toBe('ses_c');
    expect(neighbourSession(strip, 'ses_b', 'previous')).toBe('ses_a');
  });

  test('a direction off the end of the list lands nowhere', () => {
    expect(neighbourSession(strip, 'ses_c', 'next')).toBeUndefined();
    expect(neighbourSession(strip, 'ses_a', 'previous')).toBeUndefined();
  });

  test('a subagent listed under the open root is a neighbour like any other', () => {
    // The strip folds the active root's children into the same row, so the
    // swipe follows it in rather than stepping over it.
    const withChild = [{ asid: 'ses_a' }, { asid: 'ses_a_child' }, { asid: 'ses_b' }];
    expect(neighbourSession(withChild, 'ses_a', 'next')).toBe('ses_a_child');
  });
});

describe('whether there is anything to swipe', () => {
  test('two sessions or more', () => {
    expect(canSwipeSessions(strip)).toBe(true);
    expect(canSwipeSessions([{ asid: 'ses_a' }, { asid: 'ses_b' }])).toBe(true);
  });

  test('one session, or none, is not a swipe surface', () => {
    expect(canSwipeSessions([{ asid: 'ses_a' }])).toBe(false);
    expect(canSwipeSessions([])).toBe(false);
  });
});

describe('the gesture configuration', () => {
  // The recogniser is built from this object, so asserting it here is
  // asserting what the pill actually does with a touch.

  test('a vertical drag falls through to the transcript underneath', () => {
    // `failOffsetY` is what makes the pill transparent to a scroll: past 10pt
    // of vertical travel the pan fails and the touch belongs to the list. It
    // has to be tighter than the sideways threshold, or a diagonal drag is
    // claimed here before it can ever be handed back.
    const [failUp, failDown] = SESSION_SWIPE.failOffsetY;
    const [activeLeft, activeRight] = SESSION_SWIPE.activeOffsetX;
    expect(failUp).toBe(-10);
    expect(failDown).toBe(10);
    expect(activeLeft).toBe(-12);
    expect(activeRight).toBe(12);
    expect(Math.abs(failDown)).toBeLessThan(Math.abs(activeRight));
  });

  test('a tap is never the start of a swipe', () => {
    expect(SESSION_SWIPE.activeOffsetX[1]).toBeGreaterThan(0);
  });
});

describe('what a finished drag meant', () => {
  test('far enough to the left is the next session', () => {
    expect(sessionSwipeDirection(-SESSION_SWIPE.distance, 0, 0)).toBe('next');
  });

  test('far enough to the right is the previous one', () => {
    expect(sessionSwipeDirection(SESSION_SWIPE.distance, 0, 0)).toBe('previous');
  });

  test('a short flick counts on velocity alone', () => {
    expect(sessionSwipeDirection(-14, 0, -SESSION_SWIPE.velocity)).toBe('next');
  });

  test('a flick that barely moved is not a swipe', () => {
    expect(sessionSwipeDirection(-4, 0, -SESSION_SWIPE.velocity)).toBeNull();
  });

  test('a short slow drag springs back instead', () => {
    expect(sessionSwipeDirection(-20, 0, -50)).toBeNull();
  });

  test('a drag that travelled further down than sideways is never a switch', () => {
    // Even at full speed: this is the second guard, after `failOffsetY`.
    expect(sessionSwipeDirection(-60, 90, -SESSION_SWIPE.velocity)).toBeNull();
  });
});

describe('how far the pill follows the finger', () => {
  const PILL = 200;
  const limit = PILL * SESSION_SWIPE.followLimitRatio;

  test('a third of the travel, while it is inside the clamp', () => {
    expect(sessionSwipeFollow(30, PILL, true)).toBeCloseTo(10);
  });

  test('clamped to 40% of the pill, however far the finger goes', () => {
    expect(sessionSwipeFollow(1000, PILL, true)).toBeCloseTo(limit);
    expect(sessionSwipeFollow(-1000, PILL, true)).toBeCloseTo(-limit);
  });

  test('dragging off the end of the list gives a little and refuses', () => {
    const resisted = sessionSwipeFollow(90, PILL, false);
    expect(resisted).toBeGreaterThan(0);
    expect(resisted).toBeLessThan(sessionSwipeFollow(90, PILL, true));
  });
});
