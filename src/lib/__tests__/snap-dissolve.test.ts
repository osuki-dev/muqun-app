import { describe, expect, test } from 'bun:test';

import {
  SNAP_HOLD,
  SNAP_MAX_TILES,
  SNAP_TILE_PHONE,
  SNAP_TILE_TABLET,
  snapGrid,
  snapTile,
  snapTileHash,
  snapTileProgress,
  snapTileSize,
  snapTileTransform,
} from '../snap-dissolve';

const PHONE = { width: 411, height: 914 };
const RATIO = 2.625;

function tiles(width = PHONE.width, height = PHONE.height) {
  const grid = snapGrid(width, height, snapTileSize(width, height));
  return { grid, all: Array.from({ length: grid.count }, (_, i) => snapTile(grid, i)) };
}

describe('snapTileSize', () => {
  test('dust on a phone, a little coarser on a tablet', () => {
    expect(snapTileSize(411, 914)).toBe(SNAP_TILE_PHONE);
    expect(snapTileSize(914, 411)).toBe(SNAP_TILE_PHONE);
    expect(snapTileSize(1280, 800)).toBe(SNAP_TILE_TABLET);
  });
});

describe('snapGrid', () => {
  test('covers the whole window, the last row and column cut to the edge', () => {
    const grid = snapGrid(PHONE.width, PHONE.height, 18);
    expect(grid.cols).toBe(23);
    expect(grid.rows).toBe(51);
    expect(grid.count).toBe(23 * 51);
    const last = snapTile(grid, grid.count - 1);
    expect(last.x + last.w).toBeCloseTo(PHONE.width);
    expect(last.y + last.h).toBeCloseTo(PHONE.height);
    expect(last.w).toBeGreaterThan(0);
    expect(last.w).toBeLessThanOrEqual(18);
  });

  test('never asks for more sprites than the cap; the tile grows instead', () => {
    const grid = snapGrid(2000, 2000, 10);
    expect(grid.count).toBeLessThanOrEqual(SNAP_MAX_TILES);
    expect(grid.tile).toBeGreaterThan(10);
    expect(grid.cols * grid.tile).toBeGreaterThanOrEqual(2000);
  });

  test('a degenerate window is an empty grid, not NaN', () => {
    expect(snapGrid(0, 0, 18).count).toBe(0);
    expect(snapGrid(Number.NaN, 100, 18).count).toBe(0);
  });
});

describe('snapTileHash', () => {
  test('deterministic, in [0, 1), and spread out', () => {
    const values = Array.from({ length: 2000 }, (_, i) => snapTileHash(i));
    expect(values).toEqual(Array.from({ length: 2000 }, (_, i) => snapTileHash(i)));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    // Neighbours are not correlated, or the jitter would read as stripes.
    expect(new Set(values.map((v) => Math.floor(v * 10))).size).toBe(10);
    expect(Math.abs(snapTileHash(1) - snapTileHash(2))).toBeGreaterThan(0.01);
  });
});

describe('snapTileTransform', () => {
  test('at p = 0 every tile is exactly where it was cut from, fully opaque', () => {
    const { all } = tiles();
    for (const tile of all) {
      const t = snapTileTransform(tile, 0, RATIO);
      expect(t.scos).toBeCloseTo(1 / RATIO, 9);
      expect(t.ssin).toBeCloseTo(0, 9);
      expect(t.tx).toBeCloseTo(tile.x, 6);
      expect(t.ty).toBeCloseTo(tile.y, 6);
      expect(t.alpha).toBe(1);
    }
  });

  test('at p = 1 every tile is gone, so the end of the snap is not a cut', () => {
    const { all } = tiles();
    for (const tile of all) expect(snapTileTransform(tile, 1, RATIO).alpha).toBe(0);
    // And the very last tile only just finishes: the clock is not padded.
    const latest = Math.max(...all.map((tile) => 0.55 * tile.sweep + 0.25 * tile.hash));
    expect(latest).toBeGreaterThan(0.7);
  });

  test('tiles leave up and to the right, like dust in wind', () => {
    const { all } = tiles();
    for (const tile of all) {
      const t = snapTileTransform(tile, 1, 1);
      const centreX = t.tx + (t.scos * tile.w - t.ssin * tile.h) / 2;
      const centreY = t.ty + (t.ssin * tile.w + t.scos * tile.h) / 2;
      const dx = centreX - (tile.x + tile.w / 2);
      const dy = centreY - (tile.y + tile.h / 2);
      expect(dx).toBeGreaterThanOrEqual(40 - 24);
      expect(dx).toBeLessThanOrEqual(100 + 24);
      expect(dy).toBeLessThanOrEqual(-90);
      expect(dy).toBeGreaterThanOrEqual(-160);
      // Shrunk by about a third and turned no more than the cap either way.
      expect(Math.hypot(t.scos, t.ssin)).toBeCloseTo(0.65, 6);
      expect(Math.abs(Math.atan2(t.ssin, t.scos))).toBeLessThanOrEqual(0.45 + 1e-9);
    }
  });

  test('the sweep eats the picture from the left', () => {
    const { grid } = tiles();
    const row = 20;
    const leftmost = snapTile(grid, row * grid.cols);
    const rightmost = snapTile(grid, row * grid.cols + grid.cols - 1);
    // Halfway through the exit, the left edge is well on its way out and the
    // right edge has barely started, whatever their jitter.
    expect(snapTileProgress(leftmost, 0.5)).toBeGreaterThan(0.6);
    expect(snapTileProgress(rightmost, 0.5)).toBeLessThan(0.4);
  });

  test('a tile is carried away solid and only fades in the last stretch of its travel', () => {
    const { all } = tiles();
    for (const tile of all) {
      for (let p = 0; p <= 1.0001; p += 0.01) {
        const q = snapTileProgress(tile, p);
        const alpha = snapTileTransform(tile, p).alpha;
        if (q <= SNAP_HOLD) expect(alpha).toBe(1);
        else expect(alpha).toBeLessThan(1);
      }
    }
    // Ease-out: most of the fade happens early in the last stretch.
    const tile = all[0]!;
    const halfway = (SNAP_HOLD + 1) / 2;
    const p = (halfway * 0.45 + 0.55 * tile.sweep + 0.25 * tile.hash) / 1.25;
    expect(snapTileTransform(tile, p).alpha).toBeCloseTo(0.25, 2);
  });

  test('alpha only ever falls, per tile, as the exit runs', () => {
    const { all } = tiles();
    for (const tile of all.slice(0, 200)) {
      let previous = 1;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const alpha = snapTileTransform(tile, p).alpha;
        expect(alpha).toBeLessThanOrEqual(previous + 1e-12);
        previous = alpha;
      }
    }
  });

  test('writes into a given object rather than allocating one', () => {
    const { grid } = tiles();
    const tile = snapTile(grid, 7);
    const scratch = snapTile(grid, 0);
    expect(snapTile(grid, 7, scratch)).toBe(scratch);
    expect(scratch).toEqual(tile);
    const out = { scos: 0, ssin: 0, tx: 0, ty: 0, alpha: 0 };
    expect(snapTileTransform(tile, 0.4, RATIO, out)).toBe(out);
    expect(out).toEqual(snapTileTransform(tile, 0.4, RATIO));
  });
});
