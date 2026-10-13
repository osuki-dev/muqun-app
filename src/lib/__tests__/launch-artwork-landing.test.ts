import { expect, test } from 'bun:test';

import { containedImageRect } from '../hero-feather';
import { launchArtworkLanding } from '../launch-artwork-landing';

const PORTRAIT = { width: 1024, height: 2048 };
const SOURCE = 'file:///theme/portrait.webp';

test.each([
  {
    screen: { width: 390, height: 844 },
    box: 288,
    home: { x: 150, y: 160, width: 90, height: 180 },
  },
  {
    screen: { width: 1280, height: 800 },
    box: 560,
    home: { x: 225, y: 110, width: 66, height: 132 },
  },
])(
  'a full portrait lands at Home’s actual height on $screen.width × $screen.height',
  ({ screen, box, home }) => {
    const drawing = containedImageRect({ width: box, height: box }, PORTRAIT);
    const result = launchArtworkLanding({
      box: { width: box, height: box },
      intrinsic: PORTRAIT,
      source: SOURCE,
      home: { ...home, source: SOURCE, intrinsicWidth: 1024, intrinsicHeight: 2048, cropped: true },
      viewport: { x: 0, y: 24, width: screen.width, height: screen.height - 48 },
      centre: { x: screen.width / 2, y: screen.height / 2 },
    });
    expect(drawing.height * result.scale).toBeCloseTo(home.height);
    expect(drawing.width * result.scale).toBeCloseTo(home.width);
    // The old square-box fit landed the feet halfway up the target artwork.
    expect(result.centre.y + (drawing.height * result.scale) / 2).toBeCloseTo(home.y + home.height);
    expect(result.exact).toBe(false);
  }
);

test('a separate launch portrait fits as a whole without borrowing Home’s wide image dimensions', () => {
  const result = launchArtworkLanding({
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: {
      x: 12,
      y: 100,
      width: 360,
      height: 120,
      source: 'file:///theme/banner.webp',
      intrinsicWidth: 3000,
      intrinsicHeight: 1000,
    },
    viewport: { x: 0, y: 24, width: 384, height: 768 },
    centre: { x: 192, y: 408 },
  });
  expect(result.scale).toBe(0.4);
  expect(result.centre).toEqual({ x: 192, y: 160 });
  expect(result.exact).toBe(false);
});

test('a tall or clipped Home image lands wholly inside the visible safe area', () => {
  const result = launchArtworkLanding({
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: { x: 100, y: -80, width: 200, height: 1200 },
    viewport: { x: 0, y: 32, width: 400, height: 736 },
    centre: { x: 200, y: 400 },
  });
  const drawing = containedImageRect({ width: 300, height: 300 }, PORTRAIT);
  expect(result.centre.y - (drawing.height * result.scale) / 2).toBeGreaterThanOrEqual(32);
  expect(result.centre.y + (drawing.height * result.scale) / 2).toBeLessThanOrEqual(768);
  expect(result.centre.x).toBe(200);
  expect(result.exact).toBe(false);
});

test('only the same complete, visible decoded image can land without a dissolve', () => {
  const input = {
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: {
      x: 100,
      y: 100,
      width: 100,
      height: 200,
      source: SOURCE,
      intrinsicWidth: 1024,
      intrinsicHeight: 2048,
    },
    viewport: { x: 0, y: 32, width: 400, height: 736 },
    centre: { x: 200, y: 400 },
  };
  expect(launchArtworkLanding(input).exact).toBe(true);
  expect(launchArtworkLanding({ ...input, home: { ...input.home, cropped: true } }).exact).toBe(
    false
  );
  expect(
    launchArtworkLanding({ ...input, home: { ...input.home, intrinsicHeight: undefined } }).exact
  ).toBe(false);
});

test('unknown dimensions and a wholly hidden target keep the launch centred for its dissolve', () => {
  const input = {
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: { x: 100, y: 900, width: 100, height: 200 },
    viewport: { x: 0, y: 32, width: 400, height: 736 },
    centre: { x: 200, y: 400 },
  };
  const fallback = { centre: input.centre, scale: 1, exact: false };
  expect(launchArtworkLanding(input)).toEqual(fallback);
  expect(launchArtworkLanding({ ...input, intrinsic: null })).toEqual(fallback);
});
