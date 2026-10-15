import { expect, test } from 'bun:test';

import { containedImageRect } from '../hero-feather';
import {
  launchArtworkDeparture,
  launchArtworkDepartureLimit,
  launchArtworkDepartureOffset,
  launchArtworkLanding,
} from '../launch-artwork-landing';

const PORTRAIT = { width: 1024, height: 2048 };
const SOURCE = 'file:///theme/portrait.webp';

const DEPARTURE = {
  enabled: true,
  reducedMotion: false,
  box: { width: 300, height: 300 },
  centre: { x: 200, y: 400 },
  viewport: { x: 0, y: 32, width: 400, height: 736 },
};

test.each([
  { width: 800, height: 640, top: 32, bottom: 32 },
  { width: 640, height: 800, top: 160, bottom: 32 },
  { width: 800, height: 640, top: 40, bottom: 32 },
])(
  'resize projects only the already-travelled offset into the current safe range: %j',
  (screen) => {
    const initial = {
      ...DEPARTURE,
      box: { width: 473.6, height: 473.6 },
      centre: { x: 320, y: 400 },
      viewport: { x: 0, y: 32, width: 640, height: 736 },
    };
    const captured = launchArtworkDeparture(initial);
    expect(captured).toBeCloseTo(-14.72);
    const box = Math.min(screen.width * 0.74, 560);
    const resized = {
      ...initial,
      box: { width: box, height: box },
      centre: { x: screen.width / 2, y: screen.height / 2 },
      viewport: {
        x: 0,
        y: screen.top,
        width: screen.width,
        height: screen.height - screen.top - screen.bottom,
      },
    };
    const allowed = launchArtworkDeparture(resized);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const before = launchArtworkDepartureOffset(captured, progress, captured);
      const after = launchArtworkDepartureOffset(captured, progress, allowed);
      expect(after).toBeCloseTo(Math.max(captured * progress, allowed));
      // No restart or retarget when the currently travelled displacement still fits.
      if (before >= allowed) expect(after).toBe(before);
      expect(Number.isFinite(after)).toBe(true);
      expect(resized.centre.y - box / 2 + after).toBeGreaterThanOrEqual(screen.top);
      expect(resized.centre.y + box / 2 + after).toBeLessThanOrEqual(screen.height - screen.bottom);
    }
    // Returning to a roomier viewport cannot amplify the original single journey.
    expect(
      launchArtworkDepartureOffset(captured, 0.75, launchArtworkDeparture(initial))
    ).toBeCloseTo(captured * 0.75);
  }
);

test('the reported landscape endpoint is -8, not the captured -14.72 that clips 6.72 points', () => {
  const allowed = launchArtworkDeparture({
    ...DEPARTURE,
    box: { width: 560, height: 560 },
    centre: { x: 400, y: 320 },
    viewport: { x: 0, y: 32, width: 800, height: 576 },
  });
  expect(allowed).toBe(-8);
  expect(launchArtworkDepartureOffset(-14.72, 0.5, allowed)).toBe(-7.36);
  expect(launchArtworkDepartureOffset(-14.72, 1, allowed)).toBe(-8);
});

test('a resize sequence retains its safety limit instead of jumping back when space returns', () => {
  const captured = -14.72;
  let limit = captured;
  const frames = [
    { progress: 0.5, allowed: captured, offset: -7.36 },
    { progress: 0.5, allowed: -8, offset: -7.36 },
    { progress: 0.75, allowed: -8, offset: -8 },
    { progress: 0.75, allowed: captured, offset: -8 },
    { progress: 1, allowed: captured, offset: -8 },
    { progress: 1, allowed: -3, offset: -3 },
    { progress: 1, allowed: 0, offset: 0 },
    { progress: 1, allowed: captured, offset: 0 },
  ];
  for (const frame of frames) {
    limit = launchArtworkDepartureLimit(limit, frame.allowed);
    expect(launchArtworkDepartureOffset(captured, frame.progress, limit)).toBe(frame.offset);
    expect(limit).toBeGreaterThanOrEqual(frame.allowed);
    expect(Number.isFinite(limit)).toBe(true);
  }
  expect(launchArtworkDepartureLimit(NaN, -8)).toBe(0);
  expect(launchArtworkDepartureLimit(-8, Infinity)).toBe(0);
});

test('inset changes, no room, reduced motion and invalid resize values yield finite safe offsets', () => {
  for (const progress of [0, 0.5, 1]) {
    for (const top of [245, 250, 251]) {
      const allowed = launchArtworkDeparture({
        ...DEPARTURE,
        viewport: { ...DEPARTURE.viewport, y: top, height: 768 - top },
      });
      const offset = launchArtworkDepartureOffset(-14.72, progress, allowed);
      expect(Number.isFinite(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(Math.min(0, top - 250));
      expect(offset).toBeLessThanOrEqual(0);
    }
    for (const flags of [{ enabled: false }, { reducedMotion: true }]) {
      expect(
        launchArtworkDepartureOffset(
          -14.72,
          progress,
          launchArtworkDeparture({ ...DEPARTURE, ...flags })
        )
      ).toBe(0);
    }
  }
  for (const [captured, progress, allowed] of [
    [NaN, 0.5, -8],
    [-14.72, Infinity, -8],
    [-14.72, 0.5, NaN],
    [-14.72, -1, -8],
    [2, 0.5, -8],
    [-14.72, 0.5, 2],
  ] as const) {
    expect(launchArtworkDepartureOffset(captured, progress, allowed)).toBe(0);
  }
  expect(launchArtworkDepartureOffset(-14.72, 2, -8)).toBe(-8);
});

test.each([
  { width: 150, height: 300 },
  { width: 300, height: 150 },
  { width: 300, height: 300 },
])('independent artwork gets a restrained upward departure for a $width × $height box', (box) => {
  const delta = launchArtworkDeparture({ ...DEPARTURE, box });
  expect(delta).toBeLessThan(0);
  expect(delta).toBeGreaterThanOrEqual(-16);
  expect(DEPARTURE.centre.y + delta - box.height / 2).toBeGreaterThanOrEqual(DEPARTURE.viewport.y);
});

test('departure scales with the safe viewport and never moves a full box past its edge', () => {
  expect(launchArtworkDeparture(DEPARTURE)).toBeCloseTo(-14.72);
  expect(
    launchArtworkDeparture({
      ...DEPARTURE,
      centre: { x: 640, y: 400 },
      viewport: { x: 24, y: 24, width: 1232, height: 752 },
    })
  ).toBeCloseTo(-15.04);
  expect(
    launchArtworkDeparture({
      ...DEPARTURE,
      centre: { x: 400, y: 640 },
      viewport: { x: 24, y: 24, width: 752, height: 1232 },
    })
  ).toBe(-16);
  expect(launchArtworkDeparture({ ...DEPARTURE, centre: { x: 200, y: 184 } })).toBe(-2);
  expect(launchArtworkDeparture({ ...DEPARTURE, centre: { x: 200, y: 182 } })).toBe(0);
  expect(
    launchArtworkDeparture({ ...DEPARTURE, viewport: { x: 0, y: 32, width: 400, height: 400 } })
  ).toBe(0);
});

test('default logos, reduced motion, invalid geometry and already clipped boxes stay static', () => {
  expect(launchArtworkDeparture({ ...DEPARTURE, enabled: false })).toBe(0);
  expect(launchArtworkDeparture({ ...DEPARTURE, reducedMotion: true })).toBe(0);
  expect(launchArtworkDeparture({ ...DEPARTURE, box: { width: NaN, height: 300 } })).toBe(0);
  expect(launchArtworkDeparture({ ...DEPARTURE, box: { width: 300, height: 0 } })).toBe(0);
  expect(launchArtworkDeparture({ ...DEPARTURE, centre: { x: Infinity, y: 400 } })).toBe(0);
  expect(launchArtworkDeparture({ ...DEPARTURE, centre: { x: 100, y: 400 } })).toBe(0);
});

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

test('a separate launch portrait keeps its own contain composition instead of borrowing Home’s dimensions', () => {
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
  expect(result).toEqual({ centre: { x: 192, y: 408 }, scale: 1, exact: false });
});

test('Ink’s 1254-square full-body traveler never flies toward its independent 1536×1024 scene', () => {
  const result = launchArtworkLanding({
    box: { width: 304, height: 304 },
    intrinsic: { width: 1254, height: 1254 },
    source: 'file:///theme/launch-traveler.png',
    home: {
      x: 0,
      y: 110,
      width: 411,
      height: 274,
      source: 'file:///theme/home-scene.png',
      intrinsicWidth: 1536,
      intrinsicHeight: 1024,
      cropped: true,
    },
    viewport: { x: 0, y: 24, width: 411, height: 866 },
    centre: { x: 205.5, y: 457 },
  });
  expect(result).toEqual({ centre: { x: 205.5, y: 457 }, scale: 1, exact: false });
});

test('a tall or clipped Home image lands wholly inside the visible safe area', () => {
  const result = launchArtworkLanding({
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: { x: 100, y: -80, width: 200, height: 1200, source: SOURCE },
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
  expect(launchArtworkLanding(input).centre).toEqual({ x: 150, y: 200 });
  expect(launchArtworkLanding(input).scale).toBeCloseTo(2 / 3);
  expect(launchArtworkLanding({ ...input, home: { ...input.home, cropped: true } }).exact).toBe(
    false
  );
  expect(
    launchArtworkLanding({ ...input, home: { ...input.home, intrinsicHeight: undefined } }).exact
  ).toBe(false);
});

test('a same-image zero-distance landing stays exact rather than adding a departure', () => {
  expect(
    launchArtworkLanding({
      box: { width: 300, height: 300 },
      intrinsic: PORTRAIT,
      source: SOURCE,
      home: {
        x: 125,
        y: 250,
        width: 150,
        height: 300,
        source: SOURCE,
        intrinsicWidth: PORTRAIT.width,
        intrinsicHeight: PORTRAIT.height,
      },
      viewport: DEPARTURE.viewport,
      centre: DEPARTURE.centre,
    })
  ).toEqual({ centre: DEPARTURE.centre, scale: 1, exact: true });
});

test('unknown dimensions and a wholly hidden target keep the launch centred for its dissolve', () => {
  const input = {
    box: { width: 300, height: 300 },
    intrinsic: PORTRAIT,
    source: SOURCE,
    home: { x: 100, y: 900, width: 100, height: 200, source: SOURCE },
    viewport: { x: 0, y: 32, width: 400, height: 736 },
    centre: { x: 200, y: 400 },
  };
  const fallback = { centre: input.centre, scale: 1, exact: false };
  expect(launchArtworkLanding(input)).toEqual(fallback);
  expect(launchArtworkLanding({ ...input, intrinsic: null })).toEqual(fallback);
});
