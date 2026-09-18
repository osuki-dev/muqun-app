import type { InkBloomEdge } from './ink-bloom-shader';

/**
 * The shape of the launch picture, as the ink bloom's front has to know it.
 *
 * ## The problem
 *
 * The opening's front and its rim used to start from a circle -- a fixed
 * fraction of the launch box, centred on the hero. That circle has nothing to
 * do with the picture actually drawn. A theme pack ships whatever it likes in
 * `home.hero`: a character on a transparent background, a wide banner, a
 * square logo. So the ring closed around empty paper for one pack, cut across
 * the drawing for the next, and in both cases the reveal visibly began as a
 * disc rather than as the picture waking up.
 *
 * What the front should start from is the picture's own edge: the alpha
 * silhouette when the artwork has one, and the drawn rectangle when it does
 * not. This module is that edge, expressed in the one form the shader can
 * evaluate cheaply.
 *
 * ## The form, and why it is this one
 *
 * The front is radial -- it grows outward from a centre -- so the edge only
 * ever has to answer one question: **how far is the outline, in this
 * direction?** That is a function of angle alone, and two facts about
 * `SkRuntimeEffect` decide how it is stored:
 *
 *  - runtime effects are held to ES2 semantics, where an array may not be
 *    indexed by a value computed at runtime. A lookup table of radii, which is
 *    the obvious representation, is therefore not available at all.
 *  - a second `uniform shader` -- the distance field as an image -- would add
 *    a child that every existing caller of the effect must now bind, and the
 *    effect has another caller (the in-app re-skin) on another branch.
 *
 * So the outline is stored as the first {@link HERO_EDGE_HARMONICS} terms of
 * the Fourier series of its radius, in fixed-size uniforms the shader reads by
 * name. Evaluating it needs no trigonometry at all: the fragment already has
 * the unit direction, which *is* `(cos t, sin t)`, and every higher harmonic
 * follows from it by one complex multiply. Ten harmonics is a silhouette with
 * its lobes -- a head, an outstretched arm, the long axis of a banner -- and
 * without its fringe, which is the right amount of detail for a front that a
 * noise field is about to displace anyway. Measured against five synthetic
 * silhouettes, going past ten moved the worst error by a point or two and no
 * further: what is left is detail a function of angle alone cannot hold, like
 * the gap between an arm and a body.
 *
 * A rectangle is kept as a rectangle instead: ten harmonics of a square are a
 * wavy square, and a pack whose hero is an opaque banner would get a visibly
 * rippling rim along an edge the reader can see is straight. The shader solves
 * the rounded box exactly, which is cheaper than the series as well as better.
 *
 * ## Units
 *
 * Points, throughout, measured from the picture's centre -- which is the point
 * the shader is already growing the hole from. The shape is assumed centred
 * there: a `contain` fit centres the drawing in its box, and a silhouette that
 * sits off-centre inside that box is described by the series' first harmonic
 * rather than by an offset.
 *
 * Free of every React, React Native and Skia import, so `bun test` can load
 * it. The Skia half -- decoding the picture and reading its alpha -- is
 * `use-launch-hero-edge.ts`, which has nothing in it worth testing.
 */

/** How many directions the alpha silhouette is measured along before it is fitted. */
export const HERO_EDGE_RAYS = 64;

/**
 * How many Fourier terms the fitted outline keeps.
 *
 * Four is a blob. Ten holds the lobes of a figure, packs into five `float4`
 * uniforms, and costs ten complex multiplies inside the edge band -- which is
 * the only place the shader evaluates it at all.
 */
export const HERO_EDGE_HARMONICS = 10;

/**
 * Alpha at or above this counts as the picture, out of 255.
 *
 * Low on purpose. Artwork is usually antialiased against nothing, so its
 * outermost pixels are a few percent opaque; a threshold at half would pull
 * the outline a pixel or two inside the drawing and lose thin detail like a
 * strand of hair entirely.
 */
export const HERO_EDGE_ALPHA_THRESHOLD = 24;

/**
 * How much of the drawn rectangle has to be opaque before the picture is
 * treated as a rectangle rather than as a silhouette.
 *
 * A photograph or a banner is opaque to the pixel; a drawing on a transparent
 * ground is rarely above about nine tenths. The gap between them is wide, so
 * this sits near the top of it and a stray soft corner cannot move a banner
 * into the wrong branch.
 */
export const HERO_EDGE_OPAQUE_COVERAGE = 0.985;

/**
 * How far the front travels, in multiples of the picture's own reach, before
 * the picture's shape has completely relaxed out of it.
 *
 * The front cannot merely *stop* being the silhouette: it has to keep growing
 * everywhere while it does. The radius reached in a direction is
 * `front + R(direction) * amount`, so a shape relaxing too quickly would pull
 * the front backwards along the picture's long axis while the rest of it
 * advanced -- a front that eats its own edge. Differentiating that sum shows
 * the condition exactly: the span must exceed the steepest slope of a
 * smoothstep, which is 1.5. Two leaves a quarter in hand and puts the front
 * fully circular about halfway across a phone screen, which is also where the
 * eye stops reading it as coming out of the picture.
 */
export const HERO_EDGE_RELAX_SPAN = 2;

/**
 * How far the fitted outline may stand outside the drawing, as a fraction of
 * the picture's mean reach.
 *
 * A truncated series overshoots where the outline turns sharply, and outward
 * overshoot is the one error the reader can name: a lobe of front, and then of
 * revealed wallpaper, standing off the picture in empty paper. So the whole
 * curve is shifted inward until its worst excursion is within this much of the
 * drawing, which trades the overshoot for the opposite error -- a front that
 * starts a few points *inside* the artwork, under a picture that is drawn on
 * top of it anyway, and that reads as ink soaking out from beneath the figure.
 *
 * The alternative, damping the coefficients until the overshoot goes, was
 * measured too: it flattens the shape toward a circle, which is the thing this
 * module exists to stop drawing.
 */
export const HERO_EDGE_OVERSHOOT_ALLOWANCE = 0.04;

/**
 * Where the rim rests before it takes off, as a fraction of the launch box --
 * now a distance *outside the picture's outline* rather than a radius.
 *
 * Small, because it is a halo and not a ring: far enough out that the rim is
 * not drawn on top of the artwork's own antialiased border, near enough that
 * it reads as the picture catching light rather than as a shape around it.
 */
export const HERO_EDGE_REST_FRACTION = 0.04;

/** A rectangle in points. */
export type HeroEdgeRect = { x: number; y: number; width: number; height: number };

/** A greyscale grid of the picture's alpha, row-major, one byte per sample. */
export type HeroAlphaGrid = {
  /** 0..255 per sample, `width * height` of them. */
  alpha: ArrayLike<number>;
  width: number;
  height: number;
};

/** The shape modes the shader understands. See `INK_BLOOM_SKSL`. */
export const HERO_EDGE_MODE = { rect: 1, silhouette: 2 } as const;

function finite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The picture's edge when the picture is opaque: the rectangle it is drawn in.
 *
 * `radius` is the drawn corner radius, which the launch frame does not apply
 * today -- the mirror draws the picture square-cornered -- and which is taken
 * as a parameter anyway so that a surface which *does* round its artwork can
 * hand the same shape in rather than growing a second edge model.
 */
export function heroRectEdge(
  size: { width: number; height: number },
  radius = 0
): InkBloomEdge | null {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  if (!finite(halfWidth) || !finite(halfHeight) || halfWidth <= 0 || halfHeight <= 0) return null;
  const corner = Math.min(finite(radius) && radius > 0 ? radius : 0, halfWidth, halfHeight);
  return {
    mode: HERO_EDGE_MODE.rect,
    box: [halfWidth, halfHeight, corner],
    mean: 0,
    harmonics: emptyHarmonics(),
    // The far corner of a rounded rectangle, which is the corner arc's centre
    // plus its radius. Exact for `corner` of zero, and for every other value.
    max: Math.hypot(halfWidth - corner, halfHeight - corner) + corner,
  };
}

/** Four `float4`s of zeroes: the harmonics a rectangle does not use. */
function emptyHarmonics(): number[][] {
  const groups: number[][] = [];
  for (let index = 0; index < HERO_EDGE_HARMONICS / 2; index += 1) groups.push([0, 0, 0, 0]);
  return groups;
}

/**
 * How far the outline reaches in each of {@link HERO_EDGE_RAYS} directions.
 *
 * The furthest opaque sample in each direction rather than the nearest: the
 * front grows outward, so where a ray leaves the drawing and re-enters it --
 * between an arm and a body -- the edge the front has to start from is the
 * outer one. Directions with nothing in them at all are filled in from their
 * neighbours afterwards, so the fit is never handed a hole.
 *
 * Exported for its own test: it is the step where a wrong mapping between the
 * grid and the screen would be invisible in the finished animation but obvious
 * in a table of numbers.
 */
export function heroSilhouetteRadii(
  grid: HeroAlphaGrid,
  drawn: HeroEdgeRect,
  box: { width: number; height: number }
): number[] {
  const radii = new Array<number>(HERO_EDGE_RAYS).fill(-1);
  if (grid.width <= 0 || grid.height <= 0) return radii.fill(0);
  // The drawn rectangle's centre, relative to the box's centre -- which is
  // where the front grows from. `drawn` is in the box's own coordinates, the
  // way `containedImageRect` reports it, so the two centres have to be
  // subtracted rather than assumed equal: a `contain` fit centres the drawing,
  // but a fit with a focal point does not, and measuring that one from the
  // wrong origin would be invisible here and wrong on screen.
  const originX = drawn.x + drawn.width / 2 - box.width / 2;
  const originY = drawn.y + drawn.height / 2 - box.height / 2;
  const step = (Math.PI * 2) / HERO_EDGE_RAYS;
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const alpha = grid.alpha[row * grid.width + column] ?? 0;
      if (alpha < HERO_EDGE_ALPHA_THRESHOLD) continue;
      const x = originX + ((column + 0.5) / grid.width - 0.5) * drawn.width;
      const y = originY + ((row + 0.5) / grid.height - 0.5) * drawn.height;
      const radius = Math.hypot(x, y);
      let bin = Math.round(Math.atan2(y, x) / step);
      if (bin < 0) bin += HERO_EDGE_RAYS;
      if (bin >= HERO_EDGE_RAYS) bin -= HERO_EDGE_RAYS;
      if (radius > (radii[bin] ?? -1)) radii[bin] = radius;
    }
  }
  return fillGaps(radii);
}

/** Directions with no opaque sample take the nearer of their two filled neighbours. */
function fillGaps(radii: number[]): number[] {
  const filled = radii.some((radius) => radius >= 0);
  if (!filled) return radii.map(() => 0);
  return radii.map((radius, index) => {
    if (radius >= 0) return radius;
    for (let distance = 1; distance <= HERO_EDGE_RAYS; distance += 1) {
      const before = radii[(index - distance + HERO_EDGE_RAYS) % HERO_EDGE_RAYS] ?? -1;
      const after = radii[(index + distance) % HERO_EDGE_RAYS] ?? -1;
      if (before >= 0 && after >= 0) return (before + after) / 2;
      if (before >= 0) return before;
      if (after >= 0) return after;
    }
    return 0;
  });
}

/**
 * Fit the sampled outline with {@link HERO_EDGE_HARMONICS} Fourier terms.
 *
 * Three steps, and the middle one is the whole reason this is not four lines:
 *
 * 1. the discrete transform of the sampled radii, undamped. A window over the
 *    coefficients was measured and dropped: it cuts the overshoot by flattening
 *    the shape, and a flattened shape is the circle this module exists to stop.
 * 2. the curve is slid inward until it stands no further outside the sampled
 *    outline than {@link HERO_EDGE_OVERSHOOT_ALLOWANCE} allows. The envelope it
 *    is checked against is sampled four times as finely as the table, because
 *    the ringing lives *between* the samples and comparing at the samples alone
 *    would find nothing to correct.
 * 3. `max` is taken from the reconstruction rather than from the samples. The
 *    front's early-out needs to be told how far the curve the shader evaluates
 *    reaches, not how far the drawing does.
 *
 * Returns null for a shape it cannot describe -- one whose fit would have to be
 * slid inward past its own centre -- which sends the caller to the rectangle.
 */
export function heroSilhouetteEdge(radii: number[]): InkBloomEdge | null {
  const count = radii.length;
  if (count === 0) return null;
  let mean = 0;
  for (const radius of radii) {
    if (!finite(radius)) return null;
    mean += radius;
  }
  mean /= count;
  if (mean <= 0) return null;

  const coefficients: number[] = [];
  for (let k = 1; k <= HERO_EDGE_HARMONICS; k += 1) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < count; index += 1) {
      const angle = (2 * Math.PI * k * index) / count;
      const radius = radii[index] ?? 0;
      cosine += radius * Math.cos(angle);
      sine += radius * Math.sin(angle);
    }
    coefficients.push((2 * cosine) / count, (2 * sine) / count);
  }

  const harmonics: number[][] = [];
  for (let index = 0; index < coefficients.length; index += 4) {
    harmonics.push([
      coefficients[index] ?? 0,
      coefficients[index + 1] ?? 0,
      coefficients[index + 2] ?? 0,
      coefficients[index + 3] ?? 0,
    ]);
  }

  const fitted: InkBloomEdge = {
    mode: HERO_EDGE_MODE.silhouette,
    box: [0, 0, 0],
    mean,
    harmonics,
    max: 0,
  };
  const shifted = mean - overshoot(fitted, radii, mean * HERO_EDGE_OVERSHOOT_ALLOWANCE);
  if (shifted <= 0) return null;

  const edge: InkBloomEdge = { ...fitted, mean: shifted };
  let max = 0;
  const steps = count * 4;
  for (let index = 0; index < steps; index += 1) {
    max = Math.max(max, heroEdgeRadiusAt(edge, (2 * Math.PI * index) / steps));
  }
  if (max <= 0) return null;
  return { ...edge, max };
}

/**
 * How far the fit stands outside the outline it was measured from, less what
 * it is allowed, and never less than nothing.
 *
 * The envelope between two samples is the larger of them. The table already
 * holds the *furthest* opaque sample in each direction, so the larger of a
 * neighbouring pair is a fair local ceiling; the smaller would shrink a shape
 * whose radius honestly changes that fast, like the side of a banner.
 */
function overshoot(edge: InkBloomEdge, radii: number[], allowance: number): number {
  const count = radii.length;
  const steps = count * 4;
  let worst = 0;
  for (let index = 0; index < steps; index += 1) {
    const at = index / 4;
    const lower = Math.floor(at) % count;
    const ceiling = Math.max(radii[lower] ?? 0, radii[(lower + 1) % count] ?? 0);
    worst = Math.max(worst, heroEdgeRadiusAt(edge, (2 * Math.PI * index) / steps) - ceiling);
  }
  return Math.max(0, worst - allowance);
}

/**
 * The outline's radius in one direction, in points.
 *
 * The JavaScript mirror of what the shader computes, kept so the fit can be
 * asserted against the shape it was measured from without a device. Both
 * branches are written the way the SkSL is, deliberately: if the two ever
 * disagree, the test that compares them is the thing that notices.
 */
export function heroEdgeRadiusAt(edge: InkBloomEdge, angle: number): number {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (edge.mode === HERO_EDGE_MODE.rect) return roundedBoxRadius(edge.box, cosine, sine);
  let radius = edge.mean;
  let x = cosine;
  let y = sine;
  for (const group of edge.harmonics) {
    radius += (group[0] ?? 0) * x + (group[1] ?? 0) * y;
    let next = x * cosine - y * sine;
    y = y * cosine + x * sine;
    x = next;
    radius += (group[2] ?? 0) * x + (group[3] ?? 0) * y;
    next = x * cosine - y * sine;
    y = y * cosine + x * sine;
    x = next;
  }
  return Math.max(0, radius);
}

/**
 * Where a ray from the centre leaves a rounded rectangle.
 *
 * The sharp box is one division per axis; the arc is the positive root of the
 * ray against the corner circle. Which of the two applies is decided by where
 * the sharp hit lands: past the straight run on both axes at once means the
 * ray left through a corner.
 */
function roundedBoxRadius(box: number[], cosine: number, sine: number): number {
  const halfWidth = box[0] ?? 0;
  const halfHeight = box[1] ?? 0;
  if (halfWidth <= 0 || halfHeight <= 0) return 0;
  const corner = Math.min(box[2] ?? 0, halfWidth, halfHeight);
  const insetX = Math.max(0, halfWidth - corner);
  const insetY = Math.max(0, halfHeight - corner);
  const ax = Math.abs(cosine);
  const ay = Math.abs(sine);
  const straight = Math.min(
    ax > 1e-6 ? halfWidth / ax : Number.POSITIVE_INFINITY,
    ay > 1e-6 ? halfHeight / ay : Number.POSITIVE_INFINITY
  );
  if (straight * ax - insetX <= 0 || straight * ay - insetY <= 0) return straight;
  const along = ax * insetX + ay * insetY;
  const discriminant = along * along - (insetX * insetX + insetY * insetY - corner * corner);
  return along + Math.sqrt(Math.max(0, discriminant));
}

/**
 * The picture's edge, read off its alpha.
 *
 * Returns the drawn rectangle for artwork that has no silhouette to speak of.
 * That is not a fallback but the right answer: for an opaque banner the edge
 * the reader can see *is* the rectangle, and a series fitted to one would ripple
 * along a straight line.
 */
export function heroAlphaEdge(
  grid: HeroAlphaGrid,
  drawn: HeroEdgeRect,
  box: { width: number; height: number }
): InkBloomEdge | null {
  if (grid.width <= 0 || grid.height <= 0) return null;
  if (!(drawn.width > 0) || !(drawn.height > 0)) return null;
  let opaque = 0;
  const total = grid.width * grid.height;
  for (let index = 0; index < total; index += 1) {
    if ((grid.alpha[index] ?? 0) >= HERO_EDGE_ALPHA_THRESHOLD) opaque += 1;
  }
  if (opaque === 0) return null;
  if (opaque / total >= HERO_EDGE_OPAQUE_COVERAGE) {
    return heroRectEdge({ width: drawn.width, height: drawn.height });
  }
  return heroSilhouetteEdge(heroSilhouetteRadii(grid, drawn, box));
}

/**
 * How much of the picture's shape is still in the front, and at what scale.
 *
 * One number does both jobs, because the shader multiplies the outline's
 * radius by it: the hero's own scale as it flies into Home's band, times the
 * share of the shape that has not yet relaxed out of the travelling front. See
 * {@link HERO_EDGE_RELAX_SPAN} for why the relaxation has to be this gradual.
 *
 * A worklet: it runs once per frame on the UI thread, beside the uniforms.
 */
export function heroEdgeAmount(front: number, max: number, scale: number): number {
  'worklet';
  if (!(max > 0) || !(scale > 0) || !(front >= 0)) return 0;
  const span = max * scale * HERO_EDGE_RELAX_SPAN;
  const t = Math.min(1, Math.max(0, front / span));
  return scale * (1 - t * t * (3 - 2 * t));
}

/**
 * Whether the picture behind this URI is one the app can actually read.
 *
 * A themed launch draws a file the app downloaded and owns. An unthemed one
 * draws a compiled drawable, and what the splash mirror hands over for that is
 * the resource's *name* -- nothing can open it, so nothing can measure it.
 *
 * The distinction is not only about the measurement. It decides the fallback
 * too: a picture that could be measured and has not been yet is known to fill
 * the box it is drawn in, because every launch image is contained in a box
 * built for it, so the box is a fair stand-in. A compiled mark is not -- it
 * may be a small badge with a wide margin, and drawing a rim around the margin
 * would be a worse guess than the circle the opening used to draw. So the
 * unreadable case keeps the old behaviour exactly.
 */
export function isMeasurableHeroUri(uri: string | undefined | null): uri is string {
  return typeof uri === 'string' && /^(file|content|https?|asset|data):/.test(uri);
}

/**
 * Which edge the opening draws, given what it knows so far.
 *
 * Three rules, and the last is the one that matters:
 *
 *  - the measured edge when the picture has been read;
 *  - the box it is drawn in when it has not, which is the documented fallback:
 *    a rectangle that is at least the right size in the right place, rather
 *    than a wait. No picture at all means no edge, and the front opens from a
 *    point exactly as it did before any of this existed;
 *  - **whatever was in use when the opening started, from then on.** The
 *    measurement is a decode racing a launch, and a decode that lands a frame
 *    late must not change the shape of a rim that is already on screen. An
 *    opening that somehow started before anything was chosen is the one case
 *    that falls through, because there is nothing yet to hold on to.
 */
export function chooseHeroEdge(input: {
  /** The measured edge, once the picture has been read. */
  measured: InkBloomEdge | null;
  /** The box the picture is drawn in, as an edge, or null when it drew none. */
  fallback: InkBloomEdge | null;
  /** What the opening settled on when it started, if it has started. */
  settled: InkBloomEdge | null;
  /** Whether the opening has started, and the shape may no longer change. */
  started: boolean;
}): InkBloomEdge | null {
  if (input.started && input.settled) return input.settled;
  return input.measured ?? input.fallback;
}

/** The stored form's version, so a changed fit cannot be read back as the old one. */
const STORED_VERSION = 1;

/**
 * The edge as a string, in units of the box it was measured in.
 *
 * Measuring the picture costs a decode, and the launch it is for is the one
 * frame of the app's life that has nothing to spare -- so the first launch
 * after a pack is applied measures, and every launch after that reads the
 * answer back before the first frame is drawn. Normalised on the way out and
 * scaled on the way back in, so the same stored shape serves a rotated window
 * or a larger phone.
 */
export function encodeHeroEdge(edge: InkBloomEdge, scale: number): string | null {
  if (!(scale > 0)) return null;
  return JSON.stringify({
    v: STORED_VERSION,
    mode: edge.mode,
    box: edge.box.map((value) => value / scale),
    mean: edge.mean / scale,
    harmonics: edge.harmonics.map((group) => group.map((value) => value / scale)),
    max: edge.max / scale,
  });
}

/** The inverse, refusing anything it does not recognise rather than guessing. */
export function decodeHeroEdge(
  stored: string | undefined | null,
  scale: number
): InkBloomEdge | null {
  if (!stored || !(scale > 0)) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.v !== STORED_VERSION) return null;
    const mode = value.mode;
    if (mode !== HERO_EDGE_MODE.rect && mode !== HERO_EDGE_MODE.silhouette) return null;
    const box = numbers(value.box, 3);
    const mean = value.mean;
    const max = value.max;
    if (!box || !finite(mean as number) || !finite(max as number) || !((max as number) > 0)) {
      return null;
    }
    const groups = Array.isArray(value.harmonics) ? value.harmonics : null;
    if (!groups || groups.length !== HERO_EDGE_HARMONICS / 2) return null;
    const harmonics: number[][] = [];
    for (const group of groups) {
      const quad = numbers(group, 4);
      if (!quad) return null;
      harmonics.push(quad.map((entry) => entry * scale));
    }
    return {
      mode,
      box: box.map((entry) => entry * scale),
      mean: (mean as number) * scale,
      harmonics,
      max: (max as number) * scale,
    };
  } catch {
    return null;
  }
}

function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out: number[] = [];
  for (const entry of value) {
    if (!finite(entry as number)) return null;
    out.push(entry as number);
  }
  return out;
}
