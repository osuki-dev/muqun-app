import { describe, expect, test } from 'bun:test';

import {
  SNAP_MAX_TILES,
  SNAP_TILE_PHONE,
  SNAP_TILE_TABLET,
  snapCellSize,
  snapGrid,
  snapTileSize,
} from '../snap-dissolve';

const PHONE = { width: 411.43, height: 914.29 };
const RATIO = 2.625;
const CELL = snapCellSize(PHONE.width, PHONE.height, RATIO);

describe('grain size', () => {
  test('dust on a phone, a little coarser on a tablet', () => {
    expect(snapTileSize(411, 914)).toBe(SNAP_TILE_PHONE);
    expect(snapTileSize(1280, 800)).toBe(SNAP_TILE_TABLET);
  });

  test('a bigger screen grows the grain instead of exceeding the tile budget', () => {
    const huge = snapGrid(2048, 2732, SNAP_TILE_TABLET);
    expect(huge.count).toBeLessThanOrEqual(SNAP_MAX_TILES);
    expect(huge.tile).toBeGreaterThan(SNAP_TILE_TABLET);
  });

  test('the drawn grain is a whole number of device pixels', () => {
    expect((CELL * RATIO) % 1).toBeCloseTo(0, 9);
    expect(Math.abs(CELL - SNAP_TILE_PHONE)).toBeLessThan(0.5 / RATIO + 1e-9);
  });
});
