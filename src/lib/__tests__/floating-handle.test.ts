/**
 * Where the editor's floating handle lands.
 *
 * The rule is one sentence -- it rests on a rail, never in the middle of the
 * file -- and it is the sentence a drag can break in four different ways, so
 * it is a table rather than three clamps read off a worklet.
 */
import { describe, expect, test } from 'bun:test';

import {
  FLING_PROJECTION_S,
  handleCorners,
  nextHandleCorner,
  reseatFloatingHandle,
  snapFloatingHandle,
  type HandleBounds,
} from '@/lib/floating-handle';

/** A phone-sized pane: the handle is anchored bottom-right, so left and up are negative. */
const BOUNDS: HandleBounds = { minX: -320, maxX: 0, minY: -560, maxY: 26 };

describe('the handle rests on a rail', () => {
  test('a slow release goes to the nearer edge', () => {
    // Left of the middle, barely moving: the left rail.
    expect(snapFloatingHandle({ x: -260, y: -100, velocityX: 0 }, BOUNDS).x).toBe(BOUNDS.minX);
    // Right of it: the right rail.
    expect(snapFloatingHandle({ x: -40, y: -100, velocityX: 0 }, BOUNDS).x).toBe(BOUNDS.maxX);
  });

  test('it never comes to rest between the rails', () => {
    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 10) {
      const rest = snapFloatingHandle({ x, y: -200, velocityX: 0 }, BOUNDS);
      expect([BOUNDS.minX, BOUNDS.maxX]).toContain(rest.x);
    }
  });

  test('the vertical is left where the finger left it', () => {
    expect(snapFloatingHandle({ x: -10, y: -211, velocityX: 0 }, BOUNDS).y).toBe(-211);
  });
});

describe('a flick carries', () => {
  test('a throw crosses the middle it never reached', () => {
    // Released just left of centre, moving right fast: the rail it was heading
    // for, not the one it happened to be nearest when the finger lifted.
    const rest = snapFloatingHandle({ x: -170, y: -100, velocityX: 2400 }, BOUNDS);
    expect(rest.x).toBe(BOUNDS.maxX);
  });

  test('and the same throw the other way', () => {
    expect(snapFloatingHandle({ x: -150, y: -100, velocityX: -2400 }, BOUNDS).x).toBe(BOUNDS.minX);
  });

  test('a drift is not a throw', () => {
    // A finger creeping right at the end of a slow drag must not throw the
    // handle across the pane: below the projection horizon it is still nearest
    // wins.
    const drift = 40 / FLING_PROJECTION_S / 4;
    expect(snapFloatingHandle({ x: -260, y: -100, velocityX: drift }, BOUNDS).x).toBe(BOUNDS.minX);
  });
});

describe('bounds are respected in both axes', () => {
  test('the vertical is clamped clear of the header and the safe area', () => {
    expect(snapFloatingHandle({ x: 0, y: -9000, velocityX: 0 }, BOUNDS).y).toBe(BOUNDS.minY);
    expect(snapFloatingHandle({ x: 0, y: 9000, velocityX: 0 }, BOUNDS).y).toBe(BOUNDS.maxY);
  });

  test('a pane with no room left snaps to the one rail it has', () => {
    const narrow: HandleBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    expect(snapFloatingHandle({ x: -80, y: -80, velocityX: -3000 }, narrow)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('the accessibility action walks the corners', () => {
  test('clockwise from the top left', () => {
    expect(handleCorners(BOUNDS)).toEqual([
      { x: -320, y: -560 },
      { x: 0, y: -560 },
      { x: 0, y: 26 },
      { x: -320, y: 26 },
    ]);
  });

  test('each action moves one corner on and the fourth comes back', () => {
    const corners = handleCorners(BOUNDS);
    let at = corners[0];
    for (const expected of [corners[1], corners[2], corners[3], corners[0]]) {
      at = nextHandleCorner(at, BOUNDS);
      expect(at).toEqual(expected);
    }
  });

  test('it continues from where a drag left the handle, not from a step count', () => {
    // Dropped near the bottom right by hand: the next action is the bottom
    // left, the corner after that one -- not wherever a remembered index had
    // got to.
    expect(nextHandleCorner({ x: -8, y: 20 }, BOUNDS)).toEqual({ x: -320, y: 26 });
  });
});

describe('a pane that changed size under a remembered position', () => {
  const LANDSCAPE: HandleBounds = { minX: -700, maxX: 0, minY: -260, maxY: 26 };

  test('a handle on the left rail is still on the left rail after a rotation', () => {
    // The nearest rail of the *new* bounds would be the right one -- 320 in
    // from it against 380 from the left -- which is exactly the answer that
    // walks the handle across the pane on every rotation.
    expect(reseatFloatingHandle({ x: -320, y: -400 }, BOUNDS, LANDSCAPE)).toEqual({
      x: -700,
      y: -260,
    });
  });

  test('and one on the right rail stays on the right', () => {
    expect(reseatFloatingHandle({ x: 0, y: -100 }, BOUNDS, LANDSCAPE)).toEqual({
      x: 0,
      y: -100,
    });
  });

  test('a position below the new floor is brought back up to it', () => {
    expect(reseatFloatingHandle({ x: 0, y: 26 }, BOUNDS, { ...LANDSCAPE, maxY: 8 }).y).toBe(8);
  });
});
