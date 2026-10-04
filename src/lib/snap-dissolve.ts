/**
 * The opening's exit: the picture turns to dust and blows away, and Home is
 * what is left.
 *
 * The launch scene's rule is that nothing ever covers the artwork. An exit
 * that faded a plane over it, or the whole sheet out at once, would still be
 * something happening *to* the picture from outside. This one is the picture
 * itself coming apart: a snapshot of the finished composition is broken into
 * fine grains, swept from left to right with jitter so the frame is eaten
 * away rather than vanishing uniformly, and each grain lifts up and to the
 * right at its own speed, turning, shrinking and tumbling in a little
 * turbulence, solid while it is carried and fading only at the end.
 *
 * ## Where it runs
 *
 * On the GPU, in one fragment shader (`SNAP_DUST_SKSL`, drawn by
 * `launch-snap.tsx`): ten to twenty thousand grains moved on the UI thread
 * cost 60-90 ms a frame on the emulators, against a 4 ms budget, so nothing
 * here runs per grain per frame on the CPU. The only per-frame input is the
 * snap's progress.
 *
 * A fragment shader has to answer "what is at this pixel?", not "where does
 * this grain go?". It answers it per **destination** grain: every cell of a
 * fine grid shows the grain that arrives there -- a square of the picture
 * taken from where that grain set out (down and to the left, by the cell's
 * own drift), turned and shrunk about the cell's centre. Ahead of the sweep a
 * cell's drift is zero, so the picture is exactly itself; behind it the cells
 * fill with grains streaming up from below-left and thin out as they shrink
 * and fade, which is where Home shows through. The content of a cell moves
 * through it as its drift grows, so the eye reads grains flowing rather than
 * squares blinking.
 *
 * `snapDustAt` below is the same arithmetic in TypeScript, for the tests: the
 * shader is generated from the constants in this file and is a line-for-line
 * port of it. Free of React, React Native, Reanimated and Skia so `bun test`
 * can load it.
 */

/** Grain edge in points: fine enough to read as dust. */
export const SNAP_TILE_PHONE = 6;

/** And on a tablet, where 6 would be thirty thousand grains for no visible gain. */
export const SNAP_TILE_TABLET = 8;

/** A window whose shorter side is at least this many points is a tablet here. */
export const SNAP_TABLET_MIN_SIDE = 600;

/** The ceiling on grains; past it the grain grows rather than the count. */
export const SNAP_MAX_TILES = 24000;

/** How much of the exit the left-to-right sweep takes, as a fraction of a grain's start. */
export const SNAP_SWEEP = 0.55;

/** How much each grain's own hash staggers its start on top of the sweep. */
export const SNAP_JITTER = 0.25;

/** How long one grain takes to leave, in the same units. */
export const SNAP_TILE_SPAN = 0.45;

/**
 * The last moment any grain can still be moving, in those units.
 *
 * Start times run up to `SWEEP + JITTER` and each grain then takes `SPAN`, so
 * on the raw schedule the rightmost grains would still be a third visible
 * when the exit's clock reads 1. The clock is stretched by this so that the
 * last grain is gone exactly when the overlay finishes -- otherwise the end of
 * the snap would be a cut.
 */
export const SNAP_END = SNAP_SWEEP + SNAP_JITTER + SNAP_TILE_SPAN;

/** The drift at the end of a grain's travel, in points: `base + range * hash`. */
export const SNAP_DRIFT = {
  x: { base: 40, range: 60 },
  y: { base: 90, range: 70 },
} as const;

/**
 * How much each grain's own speed varies: its drift is scaled by
 * `base + range * hash2`, so neighbours separate as they go.
 */
export const SNAP_SPEED = { base: 0.6, range: 0.8 } as const;

/**
 * The turbulence riding the drift, in points: two sine terms at different
 * frequencies across the travel, each at the grain's own phase, measured from
 * where they start so a grain at rest is exactly where it was cut.
 */
export const SNAP_TURBULENCE = {
  slow: { x: 10, frequency: 1.3 },
  fast: { x: 5, frequency: 3.7 },
  lift: { y: 6, frequency: 1.7 },
} as const;

/** The most a grain turns, in radians, either way. */
export const SNAP_TURN = 0.9;

/** How far through its departure a grain stays fully opaque before it fades. */
export const SNAP_HOLD = 0.5;

/** How much a grain shrinks by the time it is gone: to 0.3 of itself. */
export const SNAP_SHRINK = 0.7;

/** The grid of grains laid over the snapshot, in points. */
export type SnapGrid = {
  width: number;
  height: number;
  tile: number;
  cols: number;
  rows: number;
  count: number;
};

/** The grain size for a window: phone or tablet, before the count cap. */
export function snapTileSize(width: number, height: number): number {
  return Math.min(width, height) >= SNAP_TABLET_MIN_SIDE ? SNAP_TILE_TABLET : SNAP_TILE_PHONE;
}

/**
 * A grid of `tile`-point squares covering `width` x `height`. If that would be
 * more than {@link SNAP_MAX_TILES} grains, the grain grows until it is not.
 */
export function snapGrid(width: number, height: number, tile: number): SnapGrid {
  const w = Math.max(0, Number.isFinite(width) ? width : 0);
  const h = Math.max(0, Number.isFinite(height) ? height : 0);
  let size = Math.max(1, Number.isFinite(tile) ? tile : SNAP_TILE_PHONE);
  let cols = Math.ceil(w / size);
  let rows = Math.ceil(h / size);
  while (cols * rows > SNAP_MAX_TILES) {
    size += 1;
    cols = Math.ceil(w / size);
    rows = Math.ceil(h / size);
  }
  return { width: w, height: h, tile: size, cols, rows, count: cols * rows };
}

/**
 * The grain size the shader draws, in points: the grid's grain rounded to a
 * whole number of device pixels, so at rest every grain edge falls on a pixel
 * edge and the picture is not resampled across a grid of hairlines.
 */
export function snapCellSize(width: number, height: number, pixelRatio: number): number {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const grid = snapGrid(width, height, snapTileSize(width, height));
  return Math.max(1, Math.round(grid.tile * ratio)) / ratio;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * A cell's number in [0, 1), the shader's hash (Dave Hoskins' `hash12`),
 * evaluated here in doubles: the same distribution, not bit-identical values.
 */
export function snapCellHash(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** The cell's further numbers, from offsets the shader uses too. */
const HASH2_OFFSET = [41, 289] as const;
const HASH3_OFFSET = [173, 37] as const;
const HASH4_OFFSET = [59, 131] as const;

/** What the shader draws at one point: where in the picture it samples, and how solid. */
export type SnapDustSample = { sx: number; sy: number; alpha: number };

/**
 * The shader's answer for the point (`x`, `y`) in points at exit progress `p`:
 * the point of the picture to sample there and its alpha, or null where no
 * grain covers it (Home shows through).
 */
export function snapDustAt(
  x: number,
  y: number,
  p: number,
  size: { width: number; height: number },
  cell: number
): SnapDustSample | null {
  const tau = Math.PI * 2;
  const kx = Math.floor(x / cell);
  const ky = Math.floor(y / cell);
  const h = snapCellHash(kx, ky);
  const h2 = snapCellHash(kx + HASH2_OFFSET[0], ky + HASH2_OFFSET[1]);
  const cx = (kx + 0.5) * cell;
  const cy = (ky + 0.5) * cell;
  const sweep = Math.min(1, Math.max(0, cx / Math.max(1, size.width)));
  const start = SNAP_SWEEP * sweep + SNAP_JITTER * h;
  const q = Math.min(1, Math.max(0, (p * SNAP_END - start) / SNAP_TILE_SPAN));
  if (q <= 0) return { sx: x, sy: y, alpha: 1 };
  const left = 1 - q;
  const e = 1 - left * left * left;
  const speed = SNAP_SPEED.base + SNAP_SPEED.range * h2;
  const dx =
    e * speed * (SNAP_DRIFT.x.base + SNAP_DRIFT.x.range * h) +
    SNAP_TURBULENCE.slow.x *
      (Math.sin(tau * (SNAP_TURBULENCE.slow.frequency * e + h2)) - Math.sin(tau * h2)) +
    SNAP_TURBULENCE.fast.x *
      (Math.sin(tau * (SNAP_TURBULENCE.fast.frequency * e + h)) - Math.sin(tau * h));
  const dy =
    -e * speed * (SNAP_DRIFT.y.base + SNAP_DRIFT.y.range * h) +
    SNAP_TURBULENCE.lift.y *
      (Math.cos(tau * (SNAP_TURBULENCE.lift.frequency * e + h)) - Math.cos(tau * h));
  const scale = 1 - SNAP_SHRINK * e;
  const theta = (h - 0.5) * SNAP_TURN * e;
  // As a grain shrinks it also wanders inside its cell, so the dust is not a
  // lattice of dots each sitting on its cell's centre.
  const slack = (1 - scale) * cell * 0.5;
  const ox = (snapCellHash(kx + HASH3_OFFSET[0], ky + HASH3_OFFSET[1]) - 0.5) * 2 * slack;
  const oy = (snapCellHash(kx + HASH4_OFFSET[0], ky + HASH4_OFFSET[1]) - 0.5) * 2 * slack;
  const lx = x - cx - ox;
  const ly = y - cy - oy;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ux = (cos * lx + sin * ly) / scale;
  const uy = (-sin * lx + cos * ly) / scale;
  if (Math.abs(ux) > cell / 2 || Math.abs(uy) > cell / 2) return null;
  const fade = q <= SNAP_HOLD ? 0 : (q - SNAP_HOLD) / (1 - SNAP_HOLD);
  const alpha = (1 - fade) * (1 - fade);
  if (alpha <= 0) return null;
  return { sx: cx - dx + ux, sy: cy - dy + uy, alpha };
}

/**
 * The shader: {@link snapDustAt}, line for line, in SkSL. Uniforms are the
 * snapshot (`image`, sampled in points), the sheet's `size` in points, the
 * grain `cell` in points and `progress`.
 */
export const SNAP_DUST_SKSL = `
uniform shader image;
uniform float2 size;
uniform float cell;
uniform float progress;

const float TAU = 6.283185307179586;

float hash12(float2 k) {
  float3 p3 = fract(float3(k.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 main(float2 pos) {
  float2 k = floor(pos / cell);
  float h = hash12(k);
  float h2 = hash12(k + float2(${HASH2_OFFSET[0]}.0, ${HASH2_OFFSET[1]}.0));
  float2 centre = (k + 0.5) * cell;
  float sweep = clamp(centre.x / max(1.0, size.x), 0.0, 1.0);
  float start = ${SNAP_SWEEP} * sweep + ${SNAP_JITTER} * h;
  float q = clamp((progress * ${SNAP_END} - start) / ${SNAP_TILE_SPAN}, 0.0, 1.0);
  if (q <= 0.0) {
    return image.eval(pos);
  }
  float left = 1.0 - q;
  float e = 1.0 - left * left * left;
  float speed = ${SNAP_SPEED.base} + ${SNAP_SPEED.range} * h2;
  float dx = e * speed * (${SNAP_DRIFT.x.base}.0 + ${SNAP_DRIFT.x.range}.0 * h)
    + ${SNAP_TURBULENCE.slow.x}.0 * (sin(TAU * (${SNAP_TURBULENCE.slow.frequency} * e + h2)) - sin(TAU * h2))
    + ${SNAP_TURBULENCE.fast.x}.0 * (sin(TAU * (${SNAP_TURBULENCE.fast.frequency} * e + h)) - sin(TAU * h));
  float dy = -e * speed * (${SNAP_DRIFT.y.base}.0 + ${SNAP_DRIFT.y.range}.0 * h)
    + ${SNAP_TURBULENCE.lift.y}.0 * (cos(TAU * (${SNAP_TURBULENCE.lift.frequency} * e + h)) - cos(TAU * h));
  float scale = 1.0 - ${SNAP_SHRINK} * e;
  float theta = (h - 0.5) * ${SNAP_TURN} * e;
  float slack = (1.0 - scale) * cell * 0.5;
  float2 wander = (float2(
    hash12(k + float2(${HASH3_OFFSET[0]}.0, ${HASH3_OFFSET[1]}.0)),
    hash12(k + float2(${HASH4_OFFSET[0]}.0, ${HASH4_OFFSET[1]}.0))) - 0.5) * 2.0 * slack;
  float2 l = pos - centre - wander;
  float c = cos(theta);
  float s = sin(theta);
  float2 u = float2(c * l.x + s * l.y, -s * l.x + c * l.y) / scale;
  if (abs(u.x) > cell * 0.5 || abs(u.y) > cell * 0.5) {
    return half4(0.0);
  }
  float fade = q <= ${SNAP_HOLD} ? 0.0 : (q - ${SNAP_HOLD}) / (1.0 - ${SNAP_HOLD});
  float alpha = (1.0 - fade) * (1.0 - fade);
  return image.eval(centre - float2(dx, dy) + u) * half(alpha);
}
`;
