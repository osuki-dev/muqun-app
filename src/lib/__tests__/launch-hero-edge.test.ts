/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InkBloomEdge } from '../ink-bloom-shader';
import {
  chooseHeroEdge,
  decodeHeroEdge,
  encodeHeroEdge,
  heroAlphaEdge,
  heroEdgeAmount,
  heroEdgeRadiusAt,
  heroRectEdge,
  heroSilhouetteEdge,
  heroSilhouetteRadii,
  isMeasurableHeroUri,
  HERO_EDGE_HARMONICS,
  HERO_EDGE_MODE,
  HERO_EDGE_OVERSHOOT_ALLOWANCE,
  HERO_EDGE_RAYS,
  HERO_EDGE_RELAX_SPAN,
  type HeroAlphaGrid,
} from '../launch-hero-edge';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A square grid of alpha, painted by a predicate over -0.5..0.5 on each axis. */
function paint(size: number, inside: (x: number, y: number) => boolean): HeroAlphaGrid {
  const alpha = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column + 0.5) / size - 0.5;
      const y = (row + 0.5) / size - 0.5;
      alpha[row * size + column] = inside(x, y) ? 255 : 0;
    }
  }
  return { alpha, width: size, height: size };
}

const BOX = { width: 280, height: 280 };
const WHOLE_BOX = { x: 0, y: 0, width: 280, height: 280 };

describe('heroRectEdge', () => {
  test('the drawn rectangle, as half extents about its own centre', () => {
    const edge = heroRectEdge({ width: 200, height: 120 });
    expect(edge?.mode).toBe(HERO_EDGE_MODE.rect);
    expect(edge?.box).toEqual([100, 60, 0]);
    // The far corner, which is what the front's early-out is told.
    expect(edge?.max).toBeCloseTo(Math.hypot(100, 60), 6);
  });

  test('a corner radius rounds the corner and shortens the reach', () => {
    const sharp = heroRectEdge({ width: 200, height: 120 });
    const round = heroRectEdge({ width: 200, height: 120 }, 24);
    expect(round?.box).toEqual([100, 60, 24]);
    expect(round?.max).toBeCloseTo(Math.hypot(76, 36) + 24, 6);
    expect(round?.max).toBeLessThan(sharp?.max ?? 0);
  });

  test('a radius larger than the rectangle is a stadium, not an error', () => {
    const edge = heroRectEdge({ width: 100, height: 40 }, 999);
    expect(edge?.box).toEqual([50, 20, 20]);
  });

  test('a rectangle with no area is no edge at all', () => {
    expect(heroRectEdge({ width: 0, height: 100 })).toBeNull();
    expect(heroRectEdge({ width: 100, height: Number.NaN })).toBeNull();
  });
});

describe('heroEdgeRadiusAt, on a rectangle', () => {
  const edge = heroRectEdge({ width: 200, height: 120 }) as InkBloomEdge;

  test('the sides are where the sides are', () => {
    expect(heroEdgeRadiusAt(edge, 0)).toBeCloseTo(100, 6);
    expect(heroEdgeRadiusAt(edge, Math.PI)).toBeCloseTo(100, 6);
    expect(heroEdgeRadiusAt(edge, Math.PI / 2)).toBeCloseTo(60, 6);
    expect(heroEdgeRadiusAt(edge, -Math.PI / 2)).toBeCloseTo(60, 6);
  });

  test('the corner is the corner', () => {
    expect(heroEdgeRadiusAt(edge, Math.atan2(60, 100))).toBeCloseTo(Math.hypot(100, 60), 6);
  });

  test('a rounded corner is nearer than a sharp one, and the sides are unmoved', () => {
    const round = heroRectEdge({ width: 200, height: 120 }, 30) as InkBloomEdge;
    const corner = Math.atan2(60, 100);
    expect(heroEdgeRadiusAt(round, corner)).toBeLessThan(heroEdgeRadiusAt(edge, corner));
    expect(heroEdgeRadiusAt(round, 0)).toBeCloseTo(100, 6);
    expect(heroEdgeRadiusAt(round, Math.PI / 2)).toBeCloseTo(60, 6);
  });

  test('it agrees with the rounded box distance field it stands in for', () => {
    // The shader solves the ray analytically; this is the same answer found by
    // bisecting the signed distance. If the closed form ever drifts from the
    // field it is supposed to describe, the rim stops tracing the picture.
    const round = heroRectEdge({ width: 200, height: 120 }, 24) as InkBloomEdge;
    const distance = (x: number, y: number) => {
      const px = Math.abs(x) - (100 - 24);
      const py = Math.abs(y) - (60 - 24);
      return Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - 24;
    };
    for (let index = 0; index < 180; index += 1) {
      const angle = (2 * Math.PI * index) / 180;
      let low = 0;
      let high = 400;
      for (let step = 0; step < 50; step += 1) {
        const mid = (low + high) / 2;
        if (distance(Math.cos(angle) * mid, Math.sin(angle) * mid) < 0) low = mid;
        else high = mid;
      }
      expect(heroEdgeRadiusAt(round, angle)).toBeCloseTo(low, 3);
    }
  });
});

describe('heroSilhouetteRadii', () => {
  test('a centred disc measures the same in every direction', () => {
    const grid = paint(96, (x, y) => Math.hypot(x, y) < 0.3);
    const radii = heroSilhouetteRadii(grid, WHOLE_BOX, BOX);
    expect(radii).toHaveLength(HERO_EDGE_RAYS);
    // Within a sample of the grid, which is a point and a half here.
    for (const radius of radii) expect(Math.abs(radius - 0.3 * 280)).toBeLessThan(2);
  });

  test('the furthest sample wins, so an outstretched arm is not averaged away', () => {
    // A disc with one thin spike to the right. The spike is a handful of
    // samples against a bin full of disc, and it is the spike the front has to
    // start from.
    const grid = paint(96, (x, y) => Math.hypot(x, y) < 0.15 || (Math.abs(y) < 0.02 && x < 0.45));
    const radii = heroSilhouetteRadii(grid, WHOLE_BOX, BOX);
    expect(radii[0] ?? 0).toBeGreaterThan(0.4 * 280);
  });

  test('it measures from the box centre, not from the drawing it was fitted into', () => {
    // A letterboxed picture: the drawing occupies a band in the middle of the
    // box. Measuring from the drawing's own origin instead would put every
    // radius out by half a box.
    const grid = paint(64, () => true);
    const drawn = { x: 0, y: 70, width: 280, height: 140 };
    const radii = heroSilhouetteRadii(grid, drawn, BOX);
    // Straight up and straight down reach the band's edges, 70 points away.
    const up = radii[HERO_EDGE_RAYS * 0.75] ?? 0;
    const down = radii[HERO_EDGE_RAYS * 0.25] ?? 0;
    expect(Math.abs(up - 70)).toBeLessThan(2);
    expect(Math.abs(down - 70)).toBeLessThan(2);
  });

  test('a direction with nothing in it borrows from its neighbours', () => {
    const grid = paint(64, (x, y) => y < 0 && Math.hypot(x, y) < 0.3);
    const radii = heroSilhouetteRadii(grid, WHOLE_BOX, BOX);
    // Downward is empty, and still has to be a number the fit can use.
    for (const radius of radii) expect(Number.isFinite(radius)).toBe(true);
    expect(radii.every((radius) => radius > 0)).toBe(true);
  });

  test('nothing opaque at all measures as nothing', () => {
    const radii = heroSilhouetteRadii(
      paint(32, () => false),
      WHOLE_BOX,
      BOX
    );
    expect(radii.every((radius) => radius === 0)).toBe(true);
  });
});

describe('heroSilhouetteEdge', () => {
  test('a centred disc fits as a circle of its own radius', () => {
    const radii = new Array<number>(HERO_EDGE_RAYS).fill(84);
    const edge = heroSilhouetteEdge(radii) as InkBloomEdge;
    expect(edge.mode).toBe(HERO_EDGE_MODE.silhouette);
    expect(edge.mean).toBeCloseTo(84, 6);
    expect(edge.max).toBeCloseTo(84, 6);
    for (const group of edge.harmonics) for (const value of group) expect(value).toBeCloseTo(0, 6);
  });

  test('it packs exactly the harmonics the shader has uniforms for', () => {
    const edge = heroSilhouetteEdge(new Array<number>(HERO_EDGE_RAYS).fill(50)) as InkBloomEdge;
    expect(edge.harmonics).toHaveLength(HERO_EDGE_HARMONICS / 2);
    for (const group of edge.harmonics) expect(group).toHaveLength(4);
  });

  test('an off-centre shape is described, not centred away', () => {
    // A disc pushed down the box: the first harmonic is what carries that, and
    // the fit has to reach further down than up.
    const grid = paint(96, (x, y) => Math.hypot(x, y - 0.15) < 0.25);
    const edge = heroSilhouetteEdge(heroSilhouetteRadii(grid, WHOLE_BOX, BOX)) as InkBloomEdge;
    const down = heroEdgeRadiusAt(edge, Math.PI / 2);
    const up = heroEdgeRadiusAt(edge, -Math.PI / 2);
    expect(down).toBeGreaterThan(up + 40);
  });

  /**
   * The invariant the whole fit is built around. A truncated series overshoots,
   * and an overshoot is a lobe of front standing off the picture in empty
   * paper -- the exact complaint this module answers. So it is asserted against
   * the measured outline for every shape below, between the samples as well as
   * at them, which is where the ringing lives.
   */
  test('the fit never stands further outside the outline than it is allowed', () => {
    const shapes: Record<string, (x: number, y: number) => boolean> = {
      disc: (x, y) => Math.hypot(x, y) < 0.3,
      offCentre: (x, y) => Math.hypot(x, y - 0.15) < 0.28,
      figure: (x, y) =>
        Math.hypot(x, y + 0.3) < 0.13 ||
        (Math.abs(x) < 0.11 && y > -0.18 && y < 0.35) ||
        (Math.abs(y - 0.02) < 0.05 && Math.abs(x) < 0.34),
      cross: (x, y) => Math.abs(x) < 0.08 || Math.abs(y) < 0.08,
      band: (_x, y) => Math.abs(y) < 0.2,
      corner: (x, y) => x < -0.1 && y < -0.1,
    };
    for (const [name, inside] of Object.entries(shapes)) {
      const radii = heroSilhouetteRadii(paint(96, inside), WHOLE_BOX, BOX);
      const edge = heroSilhouetteEdge(radii) as InkBloomEdge;
      expect(edge).not.toBeNull();
      const allowance =
        (radii.reduce((total, radius) => total + radius, 0) / radii.length) *
          HERO_EDGE_OVERSHOOT_ALLOWANCE +
        1e-6;
      const steps = HERO_EDGE_RAYS * 4;
      const offenders: string[] = [];
      for (let index = 0; index < steps; index += 1) {
        const at = index / 4;
        const lower = Math.floor(at) % HERO_EDGE_RAYS;
        const ceiling = Math.max(radii[lower] ?? 0, radii[(lower + 1) % HERO_EDGE_RAYS] ?? 0);
        const over = heroEdgeRadiusAt(edge, (2 * Math.PI * index) / steps) - ceiling;
        if (over > allowance) offenders.push(`${name} at ray ${at}: ${over.toFixed(1)}pt out`);
      }
      expect(offenders).toEqual([]);
    }
  });

  test('a shape with no extent is no edge', () => {
    expect(heroSilhouetteEdge(new Array<number>(HERO_EDGE_RAYS).fill(0))).toBeNull();
    expect(heroSilhouetteEdge([])).toBeNull();
    expect(heroSilhouetteEdge([Number.NaN, 1, 2])).toBeNull();
  });
});

describe('heroAlphaEdge', () => {
  test('an opaque picture is a rectangle, because its edge is one', () => {
    const edge = heroAlphaEdge(
      paint(64, () => true),
      { x: 0, y: 40, width: 280, height: 200 },
      BOX
    );
    expect(edge?.mode).toBe(HERO_EDGE_MODE.rect);
    // The drawn rectangle's own half extents, not the box's.
    expect(edge?.box).toEqual([140, 100, 0]);
  });

  test('a drawing on a transparent ground is a silhouette', () => {
    const grid = paint(96, (x, y) => Math.hypot(x, y) < 0.3);
    expect(heroAlphaEdge(grid, WHOLE_BOX, BOX)?.mode).toBe(HERO_EDGE_MODE.silhouette);
  });

  test('a picture that is very nearly opaque is still a rectangle', () => {
    // One soft corner must not move a banner into the wrong branch.
    const grid = paint(64, (x, y) => !(x > 0.47 && y > 0.47));
    expect(heroAlphaEdge(grid, WHOLE_BOX, BOX)?.mode).toBe(HERO_EDGE_MODE.rect);
  });

  test('an empty picture has no edge', () => {
    expect(
      heroAlphaEdge(
        paint(32, () => false),
        WHOLE_BOX,
        BOX
      )
    ).toBeNull();
    expect(
      heroAlphaEdge(
        paint(32, () => true),
        { x: 0, y: 0, width: 0, height: 0 },
        BOX
      )
    ).toBeNull();
  });
});

describe('heroEdgeAmount', () => {
  test('the shape is whole while the front is still on the picture', () => {
    expect(heroEdgeAmount(0, 100, 1)).toBeCloseTo(1, 6);
  });

  test('it carries the hero scale as well as the relaxation', () => {
    expect(heroEdgeAmount(0, 100, 0.4)).toBeCloseTo(0.4, 6);
  });

  test('the shape is gone once the front is a span away', () => {
    expect(heroEdgeAmount(100 * HERO_EDGE_RELAX_SPAN, 100, 1)).toBe(0);
    expect(heroEdgeAmount(10000, 100, 1)).toBe(0);
  });

  test('nothing to scale, nothing to relax', () => {
    expect(heroEdgeAmount(10, 0, 1)).toBe(0);
    expect(heroEdgeAmount(10, 100, 0)).toBe(0);
    expect(heroEdgeAmount(Number.NaN, 100, 1)).toBe(0);
  });

  /**
   * The condition {@link HERO_EDGE_RELAX_SPAN} exists for. The radius the front
   * reaches in a direction is `front + R * amount`, and a shape relaxing faster
   * than the front advances would pull that backwards along the picture's long
   * axis -- a front that eats its own edge while the rest of it grows.
   */
  test('the front never goes backwards anywhere while the shape relaxes', () => {
    const max = 120;
    for (const scale of [1, 0.55]) {
      let previous = -1;
      for (let front = 0; front <= max * HERO_EDGE_RELAX_SPAN * 1.5; front += 0.5) {
        // The furthest-reaching direction is the one at risk.
        const reach = front + max * heroEdgeAmount(front, max, scale);
        expect(reach).toBeGreaterThanOrEqual(previous);
        previous = reach;
      }
    }
  });
});

describe('isMeasurableHeroUri', () => {
  test('a themed launch draws a file the app owns, and that can be read', () => {
    expect(isMeasurableHeroUri('file:///data/user/0/dev.osuki.muqun/files/a.webp')).toBe(true);
    expect(isMeasurableHeroUri('https://example.test/hero.png')).toBe(true);
    expect(isMeasurableHeroUri('content://media/external/images/1')).toBe(true);
  });

  test('an unthemed one draws a compiled resource, whose name opens nothing', () => {
    // And so keeps the opening it has always had, rather than a rim around a
    // box that may be mostly margin.
    expect(isMeasurableHeroUri('splashscreen_logo')).toBe(false);
    expect(isMeasurableHeroUri(undefined)).toBe(false);
    expect(isMeasurableHeroUri(null)).toBe(false);
    expect(isMeasurableHeroUri('')).toBe(false);
  });
});

describe('chooseHeroEdge', () => {
  const measured = heroSilhouetteEdge(new Array<number>(HERO_EDGE_RAYS).fill(60));
  const fallback = heroRectEdge({ width: 280, height: 280 });

  test('the measurement beats the box it was measured in', () => {
    expect(chooseHeroEdge({ measured, fallback, settled: null, started: false })).toBe(measured);
  });

  test('the box is what there is until the picture has been read', () => {
    expect(chooseHeroEdge({ measured: null, fallback, settled: null, started: false })).toBe(
      fallback
    );
  });

  test('no picture, no edge -- and the front opens from a point, as it always did', () => {
    expect(
      chooseHeroEdge({ measured: null, fallback: null, settled: null, started: false })
    ).toBeNull();
  });

  test('a measurement landing after the opening started does not reshape it', () => {
    expect(chooseHeroEdge({ measured, fallback, settled: fallback, started: true })).toBe(fallback);
  });

  test('an opening that started before anything was chosen still gets an answer', () => {
    expect(chooseHeroEdge({ measured, fallback, settled: null, started: true })).toBe(measured);
  });

  test('over a whole launch: box, then measurement, then frozen', () => {
    let settled: InkBloomEdge | null = null;
    const step = (input: { measured: InkBloomEdge | null; started: boolean }) => {
      const edge = chooseHeroEdge({ ...input, fallback, settled });
      if (!input.started || settled === null) settled = edge;
      return edge;
    };
    expect(step({ measured: null, started: false })).toBe(fallback);
    expect(step({ measured, started: false })).toBe(measured);
    expect(step({ measured, started: true })).toBe(measured);
    // A second, different measurement arriving mid-flight changes nothing.
    const later = heroRectEdge({ width: 10, height: 10 });
    expect(step({ measured: later, started: true })).toBe(measured);
  });
});

describe('encodeHeroEdge and decodeHeroEdge', () => {
  const edge = heroSilhouetteEdge(
    heroSilhouetteRadii(
      paint(96, (x, y) => Math.hypot(x, y - 0.12) < 0.28),
      WHOLE_BOX,
      BOX
    )
  ) as InkBloomEdge;

  test('a round trip at the same scale is the same shape', () => {
    const stored = encodeHeroEdge(edge, 280) as string;
    const back = decodeHeroEdge(stored, 280) as InkBloomEdge;
    expect(back.mode).toBe(edge.mode);
    expect(back.mean).toBeCloseTo(edge.mean, 6);
    expect(back.max).toBeCloseTo(edge.max, 6);
    expect(back.harmonics).toHaveLength(edge.harmonics.length);
    for (let index = 0; index < edge.harmonics.length; index += 1) {
      const group = edge.harmonics[index] ?? [];
      const restored = back.harmonics[index] ?? [];
      for (let entry = 0; entry < group.length; entry += 1) {
        expect(restored[entry]).toBeCloseTo(group[entry] ?? 0, 6);
      }
    }
  });

  test('a launch on a bigger screen reads the same shape back larger', () => {
    // Which is the whole point of storing it normalised: a rotation or a
    // different phone must not cost a decode.
    const back = decodeHeroEdge(encodeHeroEdge(edge, 280) as string, 560) as InkBloomEdge;
    expect(back.max).toBeCloseTo(edge.max * 2, 6);
    expect(heroEdgeRadiusAt(back, 1.1)).toBeCloseTo(heroEdgeRadiusAt(edge, 1.1) * 2, 6);
  });

  test('a rectangle survives the trip too', () => {
    const rect = heroRectEdge({ width: 200, height: 120 }, 24) as InkBloomEdge;
    const back = decodeHeroEdge(encodeHeroEdge(rect, 200) as string, 400) as InkBloomEdge;
    expect(back.box).toEqual([200, 120, 48]);
  });

  test('anything it does not recognise is a miss, not a guess', () => {
    expect(decodeHeroEdge(undefined, 280)).toBeNull();
    expect(decodeHeroEdge('', 280)).toBeNull();
    expect(decodeHeroEdge('not json', 280)).toBeNull();
    expect(decodeHeroEdge('[]', 280)).toBeNull();
    expect(decodeHeroEdge(JSON.stringify({ v: 99, mode: 1 }), 280)).toBeNull();
    // A stored shape from a fit with a different number of harmonics.
    const stored: Record<string, unknown> = JSON.parse(encodeHeroEdge(edge, 280) as string);
    stored.harmonics = (stored.harmonics as unknown[]).slice(1);
    expect(decodeHeroEdge(JSON.stringify(stored), 280)).toBeNull();
    // And one whose numbers are not numbers.
    const broken: Record<string, unknown> = JSON.parse(encodeHeroEdge(edge, 280) as string);
    broken.max = 'wide';
    expect(decodeHeroEdge(JSON.stringify(broken), 280)).toBeNull();
  });

  test('a scale of nothing cannot be normalised by', () => {
    expect(encodeHeroEdge(edge, 0)).toBeNull();
    expect(decodeHeroEdge(encodeHeroEdge(edge, 280) as string, 0)).toBeNull();
  });
});

/**
 * The shader is the one consumer of every field above, and it cannot be
 * imported here: it compiles SkSL at module scope and Skia does not load
 * outside the app. So the contract between the two is read out of the source,
 * the way `motion-tokens.test.ts` reads durations -- a renamed uniform is
 * otherwise a launch that draws nothing and a test suite that still passes.
 */
describe('the shape the shader is given', () => {
  const source = readFileSync(join(SRC, 'lib', 'ink-bloom-shader.ts'), 'utf8');
  const uniforms = [
    'uEdgeMode',
    'uEdgeAmount',
    'uEdgeSlack',
    'uEdgeBox',
    'uEdgeMean',
    ...Array.from({ length: HERO_EDGE_HARMONICS / 2 }, (_, index) => `uEdgeH${index}`),
  ];

  test('every uniform the fit fills is declared and packed', () => {
    const missing: string[] = [];
    for (const name of uniforms) {
      if (!new RegExp(`uniform float[0-9]? +${name};`).test(source)) missing.push(`${name}: SkSL`);
      if (!new RegExp(`\\n\\s+${name}:`).test(source)) missing.push(`${name}: uniforms`);
    }
    expect(missing).toEqual([]);
  });

  test('a harmonic uniform exists for every pair the fit produces', () => {
    const declared = source.match(/uniform float4 +uEdgeH\d+;/g) ?? [];
    expect(declared).toHaveLength(HERO_EDGE_HARMONICS / 2);
    // And the series is unrolled to exactly that many terms.
    const terms = source.match(/dot\(uEdgeH\d\.(xy|zw), w\)/g) ?? [];
    expect(terms).toHaveLength(HERO_EDGE_HARMONICS);
  });

  test('the circular front is still the arithmetic it was', () => {
    // The shape contributes a literal zero when there is none, rather than a
    // different expression that happens to agree: the re-skin transition draws
    // through this same program and must not move by a pixel.
    expect(source).toContain('if (uEdgeAmount <= 0.0) return 0.0;');
    expect(source).toContain('float edge = edgeRadius(dir);');
    expect(source).toContain('float dr = r - edge - front;');
    expect(source).toContain('if (dr0 > uSlack + uEdgeSlack) return half4(coverAt(p));');
    // And the exact second early-out is skipped entirely when there is no
    // shape, so a caller opening from a point pays one comparison for all of
    // this and not a line more.
    expect(source).toContain('if (edge > 0.0) {');
  });
});
