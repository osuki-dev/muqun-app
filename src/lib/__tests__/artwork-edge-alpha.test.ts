import { describe, expect, test } from 'bun:test';

import { hasTransparentArtworkEdges, hasTransparentArtworkUpperEdges } from '../artwork-edge-alpha';

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

test('bottom-feathered scenes keep their scenic cover framing', () => {
  // Aegean has a translucent sky and near-clear foot, not a cutout silhouette.
  const readAlpha = (_x: number, y: number) => (y === 99 ? 4 : y === 0 ? 58 : 244);
  expect(hasTransparentArtworkEdges(100, 100, readAlpha)).toBe(true);
  expect(hasTransparentArtworkUpperEdges(100, 100, readAlpha)).toBe(false);
  expect(hasTransparentArtworkUpperEdges(100, 100, () => 255)).toBe(false);
});

test('upper silhouette transparency preserves portraits over the title', () => {
  expect(hasTransparentArtworkUpperEdges(100, 150, (_x, y) => (y === 0 ? 0 : 255))).toBe(true);
  expect(hasTransparentArtworkUpperEdges(100, 150, (x) => (x === 0 || x === 99 ? 0 : 255))).toBe(
    true
  );
  expect(hasTransparentArtworkUpperEdges(100, 150, () => undefined)).toBe(false);
});

test('audited scenic cover alpha stays scenic, while the Glasshouse cat stays a cutout', () => {
  // Upper perimeter samples from the native audit's light cover assets:
  // top-left, top-centre, top-right, middle-left, middle-right. Bottom fading
  // does not justify treating a full rectangular illustration as foreground.
  const covers = [
    {
      name: 'Acacia',
      width: 1254,
      height: 1254,
      alpha: [240, 243, 242, 250, 250],
      foreground: false,
    },
    { name: 'Aegean', width: 1254, height: 1254, alpha: [58, 66, 75, 244, 250], foreground: false },
    {
      name: 'Workshop',
      width: 1254,
      height: 1254,
      alpha: [247, 250, 243, 251, 249],
      foreground: false,
    },
    {
      name: 'Cypress',
      width: 1254,
      height: 1254,
      alpha: [247, 250, 243, 251, 250],
      foreground: false,
    },
    {
      name: 'Clockwork',
      width: 1254,
      height: 1254,
      alpha: [246, 250, 246, 251, 251],
      foreground: false,
    },
    { name: 'Glasshouse', width: 683, height: 1024, alpha: [0, 0, 0, 0, 0], foreground: true },
  ];
  for (const { width, height, alpha, foreground } of covers) {
    const coordinates = [
      [0, 0],
      [Math.floor((width - 1) / 2), 0],
      [width - 1, 0],
      [0, Math.floor((height - 1) / 2)],
      [width - 1, Math.floor((height - 1) / 2)],
    ];
    expect(
      hasTransparentArtworkUpperEdges(
        width,
        height,
        (x, y) => alpha[coordinates.findIndex(([px, py]) => px === x && py === y)]
      )
    ).toBe(foreground);
  }
});
