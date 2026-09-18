import { expect, test } from 'bun:test';

import {
  FRONT_OVERSHOOT,
  SNAPSHOT_BUDGET_MS,
  SNAPSHOT_STRIKES,
  denormalizeOrigin,
  halftoneCell,
  halftoneFront,
  halftoneReach,
  normalizeOrigin,
  recordSnapshotCost,
  resolveOrigin,
  selectReskinPlay,
  shouldAttemptSnapshot,
  snapshotOutcome,
  washFront,
  washGeometry,
  type ReskinConditions,
} from '../reskin-geometry';

// A phone, near enough, in points. The arithmetic below is scale-free but a
// real screen makes the numbers readable.
const SCREEN = { width: 400, height: 860 };

// The wash's bleed, restated rather than imported: `reskin-shaders.ts` reaches
// Skia, which does not load outside Metro, and the geometry does not care what
// the number is -- only that both ends of the travel are widened by it.
const BLEED = 30;

/* -- origins ------------------------------------------------------------- */

test('a caller with nothing to point at gets the default for its kind', () => {
  expect(resolveOrigin(undefined, 'theme')).toEqual({ x: 0, y: 0 });
  expect(resolveOrigin(undefined, 'font')).toEqual({ x: 0.5, y: 0.5 });
});

test('an origin that is not a number is the same as no origin at all', () => {
  expect(resolveOrigin({ x: Number.NaN, y: 0.4 }, 'font')).toEqual({ x: 0.5, y: 0.5 });
  expect(resolveOrigin({ x: 0.2, y: Number.POSITIVE_INFINITY }, 'theme')).toEqual({ x: 0, y: 0 });
});

test('a row measured off the edge of its surface is clamped, not rejected', () => {
  expect(resolveOrigin({ x: 1.4, y: -0.2 }, 'font')).toEqual({ x: 1, y: 0 });
});

test('a point becomes the fraction of the surface it sits at, and back again', () => {
  const fraction = normalizeOrigin({ x: 100, y: 645 }, SCREEN);
  expect(fraction.x).toBeCloseTo(0.25, 6);
  expect(fraction.y).toBeCloseTo(0.75, 6);
  const point = denormalizeOrigin(fraction, SCREEN);
  expect(point.x).toBeCloseTo(100, 6);
  expect(point.y).toBeCloseTo(645, 6);
});

test('a surface that has not been measured yet puts the origin in the middle', () => {
  expect(normalizeOrigin({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 });
});

test('the same fraction lands proportionally on two surfaces of different sizes', () => {
  // The whole reason origins travel as fractions: a form sheet and the app
  // behind it have no shared coordinate space on Android.
  const fraction = { x: 0.5, y: 0.8 };
  expect(denormalizeOrigin(fraction, { width: 400, height: 500 })).toEqual({ x: 200, y: 400 });
  expect(denormalizeOrigin(fraction, SCREEN)).toEqual({ x: 200, y: 688 });
});

/* -- the wash's travel --------------------------------------------------- */

test('an origin at the top-left corner sends the wash down the diagonal', () => {
  const { direction } = washGeometry({ x: 0, y: 0 }, SCREEN, BLEED);
  const expected = Math.hypot(SCREEN.width, SCREEN.height);
  expect(direction.x).toBeCloseTo(SCREEN.width / expected, 6);
  expect(direction.y).toBeCloseTo(SCREEN.height / expected, 6);
});

test('a row low on the screen sends the wash upward, and one high sends it down', () => {
  expect(washGeometry({ x: 200, y: 800 }, SCREEN, BLEED).direction.y).toBeLessThan(0);
  expect(washGeometry({ x: 200, y: 60 }, SCREEN, BLEED).direction.y).toBeGreaterThan(0);
});

test('the direction is a unit vector wherever the origin is', () => {
  for (const origin of [
    { x: 0, y: 0 },
    { x: 400, y: 860 },
    { x: 200, y: 430 },
    { x: 13, y: 777 },
  ]) {
    const { direction } = washGeometry(origin, SCREEN, BLEED);
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
  }
});

test('a surface with no size still yields a direction the shader can divide by', () => {
  const { direction } = washGeometry({ x: 0, y: 0 }, { width: 0, height: 0 }, BLEED);
  expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
});

test('the travel starts behind every corner and ends past every corner', () => {
  const origin = { x: 200, y: 800 };
  const geometry = washGeometry(origin, SCREEN, BLEED);
  for (const corner of [
    { x: 0, y: 0 },
    { x: SCREEN.width, y: 0 },
    { x: 0, y: SCREEN.height },
    { x: SCREEN.width, y: SCREEN.height },
  ]) {
    const projection =
      (corner.x - origin.x) * geometry.direction.x + (corner.y - origin.y) * geometry.direction.y;
    // Strictly outside, by the bleed: a displaced edge must not be able to
    // reach either extremity, or the first frame shows a strip of the new
    // interface and the last one a strip of the old.
    expect(projection).toBeGreaterThanOrEqual(geometry.from + BLEED);
    expect(projection).toBeLessThanOrEqual(geometry.to - BLEED);
  }
});

test('the first frame has the whole surface covered and the last has none of it', () => {
  const geometry = washGeometry({ x: 0, y: 0 }, SCREEN, BLEED);
  expect(washFront(0, geometry)).toBe(geometry.from);
  expect(washFront(1, geometry)).toBeGreaterThan(geometry.to);
});

test('the front overshoots the far corner rather than creeping off it', () => {
  // The design system's ease-out decelerates into the end, so a front that
  // finished exactly at the corner would spend the last beats crawling.
  const geometry = washGeometry({ x: 0, y: 0 }, SCREEN, BLEED);
  const travel = geometry.to - geometry.from;
  expect(washFront(1, geometry)).toBeCloseTo(geometry.from + travel * FRONT_OVERSHOOT, 6);
  expect(FRONT_OVERSHOOT).toBeGreaterThan(1);
  expect(FRONT_OVERSHOOT).toBeLessThan(1.2);
});

test('the front only ever moves forward', () => {
  const geometry = washGeometry({ x: 120, y: 700 }, SCREEN, BLEED);
  let last = Number.NEGATIVE_INFINITY;
  for (let step = 0; step <= 20; step += 1) {
    const front = washFront(step / 20, geometry);
    expect(front).toBeGreaterThan(last);
    last = front;
  }
});

/* -- the halftone's wave ------------------------------------------------- */

test('the wave reaches past the furthest corner, the furthest dot and the band', () => {
  const origin = { x: 0, y: 0 };
  const cell = 8;
  const band = 150;
  const corner = Math.hypot(SCREEN.width, SCREEN.height);
  expect(halftoneReach(origin, SCREEN, cell, band)).toBeCloseTo(
    corner + cell * Math.SQRT1_2 + band,
    6
  );
});

test('the reach is measured from the origin, so the middle of the screen is quickest', () => {
  const band = 150;
  const fromCorner = halftoneReach({ x: 0, y: 0 }, SCREEN, 8, band);
  const fromMiddle = halftoneReach({ x: 200, y: 430 }, SCREEN, 8, band);
  expect(fromMiddle).toBeLessThan(fromCorner);
});

test('nothing has dissolved on the first frame and everything has on the last', () => {
  const reach = halftoneReach({ x: 200, y: 430 }, SCREEN, 8, 150);
  expect(halftoneFront(0, reach)).toBe(0);
  expect(halftoneFront(1, reach)).toBeGreaterThan(reach);
});

test('a dot is as big as the body text it is re-setting, within reason', () => {
  expect(halftoneCell(16)).toBeCloseTo(8.32, 6);
  // A caption-sized body would give a dot too fine to read as print, and a
  // display-sized one a dot that reads as censorship rather than as halftone.
  expect(halftoneCell(2)).toBe(6);
  expect(halftoneCell(96)).toBe(14);
  expect(halftoneCell(Number.NaN)).toBe(6);
});

/* -- which transition runs, if any --------------------------------------- */

const OK: ReskinConditions = {
  kind: 'theme',
  reduceMotion: false,
  effectReady: true,
  snapshot: 'ok',
  size: SCREEN,
};

test('each kind gets its own transition', () => {
  expect(selectReskinPlay(OK)).toBe('wash');
  expect(selectReskinPlay({ ...OK, kind: 'font' })).toBe('halftone');
});

test('no photograph means no transition, however it failed', () => {
  expect(selectReskinPlay({ ...OK, snapshot: 'failed' })).toBe('none');
  expect(selectReskinPlay({ ...OK, snapshot: 'slow' })).toBe('none');
});

test('a surface with no size is not a surface', () => {
  expect(selectReskinPlay({ ...OK, size: { width: 0, height: 860 } })).toBe('none');
  expect(selectReskinPlay({ ...OK, size: { width: 400, height: 0 } })).toBe('none');
});

test('reduced motion is answered with a dissolve, not with a cut', () => {
  expect(selectReskinPlay({ ...OK, reduceMotion: true })).toBe('crossfade');
  expect(selectReskinPlay({ ...OK, kind: 'font', reduceMotion: true })).toBe('crossfade');
});

test('a device whose shader will not compile still gets the dissolve', () => {
  // The photograph is already taken and a fade needs no GPU program.
  expect(selectReskinPlay({ ...OK, effectReady: false })).toBe('crossfade');
});

test('a missing photograph outranks every other reason', () => {
  expect(selectReskinPlay({ ...OK, snapshot: 'failed', reduceMotion: true })).toBe('none');
  expect(selectReskinPlay({ ...OK, snapshot: 'failed', effectReady: false })).toBe('none');
});

test('a photograph is judged on whether it arrived and whether it was quick', () => {
  const image = {};
  expect(snapshotOutcome(image, 0)).toBe('ok');
  expect(snapshotOutcome(image, SNAPSHOT_BUDGET_MS)).toBe('ok');
  expect(snapshotOutcome(image, SNAPSHOT_BUDGET_MS + 1)).toBe('slow');
  expect(snapshotOutcome(null, 0)).toBe('failed');
  expect(snapshotOutcome(undefined, 0)).toBe('failed');
});

test('the budget stays short enough that a reader reads it as the setting landing', () => {
  expect(SNAPSHOT_BUDGET_MS).toBeLessThanOrEqual(120);
});

/* -- what a slow device is told, and how often ---------------------------- */

test('a device is asked until it has said no twice', () => {
  expect(shouldAttemptSnapshot(0)).toBe(true);
  expect(shouldAttemptSnapshot(SNAPSHOT_STRIKES - 1)).toBe(true);
  expect(shouldAttemptSnapshot(SNAPSHOT_STRIKES)).toBe(false);
  expect(shouldAttemptSnapshot(SNAPSHOT_STRIKES + 5)).toBe(false);
});

test('an over-budget capture is a strike and a quick one wipes the slate', () => {
  // The whole point of counting: `makeImageFromView` blocks the JS thread, so
  // the budget cannot cut a capture short -- it can only decide whether to ask
  // again. See the note on SNAPSHOT_STRIKES.
  expect(recordSnapshotCost(0, SNAPSHOT_BUDGET_MS + 1)).toBe(1);
  expect(recordSnapshotCost(1, 1_800)).toBe(2);
  expect(recordSnapshotCost(1, SNAPSHOT_BUDGET_MS)).toBe(0);
  expect(recordSnapshotCost(1, 10)).toBe(0);
});

test('two slow captures in a row retire the effect for the session', () => {
  let strikes = 0;
  strikes = recordSnapshotCost(strikes, 1_785);
  expect(shouldAttemptSnapshot(strikes)).toBe(true);
  strikes = recordSnapshotCost(strikes, 613);
  expect(shouldAttemptSnapshot(strikes)).toBe(false);
});

test('a device that recovers keeps its transition', () => {
  // The emulator measured 1.8s then 0.6s; a real phone that merely warms up
  // slowly must not be retired on the strength of its first frame.
  let strikes = recordSnapshotCost(0, 900);
  strikes = recordSnapshotCost(strikes, 40);
  expect(strikes).toBe(0);
  expect(shouldAttemptSnapshot(strikes)).toBe(true);
});
