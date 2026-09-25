import { describe, expect, test } from 'bun:test';

import { hasTransparentArtworkEdges } from '../artwork-edge-alpha';

describe('Classic artwork perimeter', () => {
  test('preserves foreground heads without reading the full image', () => {
    const samples: number[][] = [];
    expect(
      hasTransparentArtworkEdges(2048, 3072, (x, y) => {
        samples.push([x, y]);
        return y === 0 ? 0 : 255;
      })
    ).toBe(true);
    expect(samples.length).toBeLessThanOrEqual(8);
    expect(samples.every(([x, y]) => x === 0 || x === 2047 || y === 0 || y === 3071)).toBe(true);
  });

  test('keeps opaque illustration feathering, including opaque RGBA files', () => {
    expect(hasTransparentArtworkEdges(100, 200, () => 255)).toBe(false);
    expect(hasTransparentArtworkEdges(100, 200, () => undefined)).toBe(false);
    expect(hasTransparentArtworkEdges(100, 200, (x, y) => (x === 0 && y === 0 ? 0 : 255))).toBe(
      false
    );
  });
});
