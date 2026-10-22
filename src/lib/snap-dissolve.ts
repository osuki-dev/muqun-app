/**
 * The launch canvas turns to ash from the centre, where its art sits, and the
 * ash billows outwards like mist.
 * The snapshot stays exact ahead of the front; transparent gaps reveal the
 * real Home underneath. At most two texture samples and fixed noise work per
 * fragment, with no CPU particle objects, blur pass or additional surface.
 */

/** Grain spacing in points, rounded to device pixels by snapCellSize. */
export const SNAP_TILE_PHONE = 2.5;
export const SNAP_TILE_TABLET = 3;
export const SNAP_TABLET_MIN_SIDE = 600;
/** A visual density ceiling; fragments still do constant work regardless of count. */
export const SNAP_MAX_TILES = 131072;

export type SnapGrid = {
  width: number;
  height: number;
  tile: number;
  cols: number;
  rows: number;
  count: number;
};

export function snapTileSize(width: number, height: number): number {
  return Math.min(width, height) >= SNAP_TABLET_MIN_SIDE ? SNAP_TILE_TABLET : SNAP_TILE_PHONE;
}

/** Grow the grain only beyond the visual density ceiling. */
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

/** Align the fine grid with device pixels, including fractional display ratios. */
export function snapCellSize(width: number, height: number, pixelRatio: number): number {
  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
  const grid = snapGrid(width, height, snapTileSize(width, height));
  return Math.max(1, Math.round(grid.tile * ratio)) / ratio;
}

/** Snapshot coordinates and grain spacing are in points, not device pixels. */
export const SNAP_DUST_SKSL = /* sksl */ `
uniform shader image;
uniform float2 size;
uniform float cell;
uniform float progress;

float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + float2(1.0, 0.0)), f.x),
    mix(hash12(i + float2(0.0, 1.0)), hash12(i + float2(1.0)), f.x), f.y);
}

half4 main(float2 pos) {
  if (progress <= 0.0) return image.eval(pos);
  if (progress >= 1.0) return half4(0.0);

  // The launch art sits in the middle, so it is what turns to ash first: the
  // front starts at the centre and spreads outwards, and the ash billows out
  // from the centre like smoke, lifting a little as it goes. Eroding from every
  // edge at once read as the frame shrinking into a clump in the middle.
  float2 origin = size * float2(0.5, 0.45);
  float2 away = pos - origin;
  float reachMax = length(max(origin, size - origin));
  float radius = length(away);
  float2 outward = away / max(radius, 1.0);
  float depth = pow(clamp(radius / max(reachMax, 1.0), 0.0, 1.0), 0.85);
  // Adjacent grains share a broad, irregular erosion front.
  float billow = noise(pos / 58.0);
  float start = depth * 0.54 + billow * 0.14;
  float q = clamp((progress * 1.10 - start) / 0.42, 0.0, 1.0);
  if (q <= 0.0) return image.eval(pos);
  // Both intact and life are zero here: no remaining fragment can contribute.
  if (q >= 1.0) return half4(0.0);

  float loosen = smoothstep(0.0, 0.72, q);
  // Ash picks up speed as it leaves: a slow lift-off, then carried away.
  float carry = loosen * loosen;
  float2 drift = outward * (40.0 + 150.0 * billow) * carry + float2(0.0, -28.0) * carry;
  // A curl of turbulence, so the ash rolls like mist rather than travelling straight.
  drift += float2(sin(pos.y / 60.0 + q * 4.0), cos(pos.x / 70.0 + q * 3.0)) * 14.0 * loosen;
  float2 source = pos - drift;
  float cloud = noise(source / 36.0 + float2(q * 0.7, -q * 0.4));
  // Grains drift coherently. Using the erosion-dependent source coordinates
  // here would stretch their grid into streaks along the dissolving edge.
  float2 grainFlow = outward * 36.0 * progress + float2(0.0, -12.0) * progress;
  grainFlow += float2(sin(pos.y / 90.0 + progress * 3.0), cos(pos.x / 80.0 + progress * 2.0)) * 2.0 * progress;
  float2 grid = (pos - grainFlow) / max(cell, 1.0);
  float grainHash = hash12(floor(grid));
  float otherHash = hash12(floor(grid) + 19.0);
  float2 centre = float2(0.18 + grainHash * 0.64, 0.18 + otherHash * 0.64);
  float grain = 1.0 - smoothstep(0.04, 0.16 + 0.22 * otherHash, length(fract(grid) - centre));
  grain *= (0.45 + 0.55 * grainHash) * smoothstep(0.1, 0.25, grainHash);

  float intact = 1.0 - smoothstep(0.01, 0.4, q);
  float life = 1.0 - smoothstep(0.12, 1.0, q);
  // More soft cloud than grain: the snap reads as mist dispersing, with grit in it.
  float dust = (grain * 0.5 + cloud * cloud * 0.45) * life;
  half4 original = image.eval(pos);
  half4 sample = image.eval(source);
  // Keep some theme colour in neutral ash, with premultiplied channels even
  // when the original image contains transparency.
  half grey = mix(dot(sample.rgb, half3(0.2126, 0.7152, 0.0722)), sample.a * 0.52, 0.5);
  half3 colour = mix(sample.rgb, half3(grey), 0.72);
  half dustAlpha = half((1.0 - intact) * dust);
  return original * half(intact) + half4(colour, sample.a) * dustAlpha;
}
`;
