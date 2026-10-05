import { describe, expect, test } from 'bun:test';

import {
  SNAP_DUST_SKSL,
  SNAP_END,
  SNAP_MAX_TILES,
  SNAP_TILE_PHONE,
  SNAP_TILE_TABLET,
  snapCellHash,
  snapCellSize,
  snapDustAt,
  snapGrid,
  snapTileSize,
} from '../snap-dissolve';

const PHONE = { width: 411.43, height: 914.29 };
const RATIO = 2.625;
const CELL = snapCellSize(PHONE.width, PHONE.height, RATIO);

/** Every grain centre on the phone, every `step`th column and row. */
function centres(step = 3) {
  const out: [number, number][] = [];
  for (let y = CELL / 2; y < PHONE.height; y += CELL * step) {
    for (let x = CELL / 2; x < PHONE.width; x += CELL * step) out.push([x, y]);
  }
  return out;
}

describe('grain size', () => {
  test('dust on a phone, a little coarser on a tablet', () => {
    expect(snapTileSize(411, 914)).toBe(SNAP_TILE_PHONE);
    expect(snapTileSize(1280, 800)).toBe(SNAP_TILE_TABLET);
    expect(SNAP_TILE_PHONE).toBe(6);
    expect(SNAP_TILE_TABLET).toBe(8);
  });

  test('neither emulator reaches the cap, and a bigger screen grows the grain instead', () => {
    expect(snapGrid(PHONE.width, PHONE.height, SNAP_TILE_PHONE).count).toBe(69 * 153);
    expect(snapGrid(1280, 800, SNAP_TILE_TABLET).count).toBe(160 * 100);
    const huge = snapGrid(2048, 2732, SNAP_TILE_TABLET);
    expect(huge.count).toBeLessThanOrEqual(SNAP_MAX_TILES);
    expect(huge.tile).toBeGreaterThan(SNAP_TILE_TABLET);
  });

  test('the drawn grain is a whole number of device pixels', () => {
    expect((CELL * RATIO) % 1).toBeCloseTo(0, 9);
    expect(Math.abs(CELL - SNAP_TILE_PHONE)).toBeLessThan(0.5 / RATIO + 1e-9);
  });
});

describe('snapCellHash', () => {
  test('deterministic, in [0, 1), spread out and uncorrelated with its neighbours', () => {
    const values: number[] = [];
    for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) values.push(snapCellHash(x, y));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(snapCellHash(7, 9)).toBe(snapCellHash(7, 9));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(new Set(values.map((v) => Math.floor(v * 10))).size).toBe(10);
  });
});

describe('snapDustAt', () => {
  test('at p = 0 the picture is exactly itself everywhere', () => {
    for (const [x, y] of centres()) {
      for (const [ox, oy] of [
        [0, 0],
        [-CELL * 0.49, CELL * 0.49],
      ]) {
        expect(snapDustAt(x + ox, y + oy, 0, PHONE, CELL)).toEqual({
          sx: x + ox,
          sy: y + oy,
          alpha: 1,
        });
      }
    }
  });

  test('at p = 1 every grain is gone, so the end of the snap is not a cut', () => {
    for (const [x, y] of centres()) expect(snapDustAt(x, y, 1, PHONE, CELL)).toBeNull();
  });

  test('the sweep eats the picture from the left', () => {
    // A third of the way in, the left edge has broken up and the right edge
    // is still the picture.
    let leftIntact = 0;
    let rightIntact = 0;
    let rows = 0;
    for (let y = CELL / 2; y < PHONE.height; y += CELL * 2) {
      rows += 1;
      const left = snapDustAt(CELL / 2, y, 0.35, PHONE, CELL);
      const right = snapDustAt(PHONE.width - CELL / 2, y, 0.35, PHONE, CELL);
      if (left?.sx === CELL / 2 && left.sy === y) leftIntact += 1;
      if (right?.sx === PHONE.width - CELL / 2 && right.sy === y) rightIntact += 1;
    }
    expect(leftIntact / rows).toBeLessThan(0.1);
    expect(rightIntact / rows).toBe(1);
  });

  test('grains carry the picture up and to the right: what a cell shows came from below-left', () => {
    let moving = 0;
    for (const [x, y] of centres()) {
      const sample = snapDustAt(x, y, 0.7, PHONE, CELL);
      if (!sample || (sample.sx === x && sample.sy === y)) continue;
      moving += 1;
      // Drift 0.6..1.4 x (40..100, 90..160) with up to 30 / 12 of turbulence.
      expect(x - sample.sx).toBeGreaterThanOrEqual(-30);
      expect(x - sample.sx).toBeLessThanOrEqual(1.4 * 100 + 30);
      expect(sample.sy - y).toBeGreaterThanOrEqual(-12);
      expect(sample.sy - y).toBeLessThanOrEqual(1.4 * 160 + 12);
    }
    expect(moving).toBeGreaterThan(100);
  });

  test('grains are solid while carried and thin out as they shrink, so Home shows through', () => {
    // Behind the front, a grain's centre is covered and its corners are not.
    let solidCentres = 0;
    let bareCorners = 0;
    let behind = 0;
    for (const [x, y] of centres()) {
      const centre = snapDustAt(x, y, 0.45, PHONE, CELL);
      if (!centre || (centre.sx === x && centre.sy === y)) continue;
      behind += 1;
      if (centre.alpha === 1) solidCentres += 1;
      if (snapDustAt(x + CELL * 0.49, y + CELL * 0.49, 0.45, PHONE, CELL) === null)
        bareCorners += 1;
    }
    expect(behind).toBeGreaterThan(50);
    expect(solidCentres / behind).toBeGreaterThan(0.3);
    expect(bareCorners / behind).toBeGreaterThan(0.8);
  });
});

describe('SNAP_DUST_SKSL', () => {
  test('is generated from the same constants', () => {
    expect(SNAP_DUST_SKSL).toContain(`progress * ${SNAP_END}`);
    expect(SNAP_DUST_SKSL).toContain('uniform shader image;');
    expect(SNAP_DUST_SKSL).toContain('half4 main(float2 pos)');
    expect(SNAP_DUST_SKSL).not.toContain('undefined');
    // No floating-point noise from the interpolated constants (e.g. 0.30000000000000004).
    expect(/\d\.\d*(0000\d|9999\d)/.test(SNAP_DUST_SKSL)).toBe(false);
  });
});
