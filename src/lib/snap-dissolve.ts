/**
 * The launch canvas erodes from its edges into fine, softly drifting ash.
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

  float2 uv = pos / max(size, float2(1.0));
  float2 edge = min(uv, 1.0 - uv) * 2.0;
  float depth = pow(clamp(min(edge.x, edge.y), 0.0, 1.0), 0.75);
  // Adjacent grains share a broad, irregular erosion front.
  float billow = noise(pos / 58.0);
  float start = depth * 0.54 + billow * 0.14;
  float q = clamp((progress * 1.10 - start) / 0.42, 0.0, 1.0);
  if (q <= 0.0) return image.eval(pos);

  float loosen = smoothstep(0.0, 0.72, q);
  float2 drift = float2(18.0 + 24.0 * billow, -24.0 - 30.0 * billow) * loosen;
  drift += float2(sin(pos.y / 75.0 + q * 3.0), cos(pos.x / 89.0 + q * 2.0)) * 7.0 * loosen;
  float2 source = pos - drift;
  float cloud = noise(source / 24.0 + float2(q * 0.7, -q * 0.4));
  // Grains drift coherently. Using the erosion-dependent source coordinates
  // here would stretch their grid into streaks along the dissolving edge.
  float2 grainFlow = float2(18.0, -28.0) * progress;
  grainFlow += float2(sin(pos.y / 90.0 + progress * 3.0), cos(pos.x / 80.0 + progress * 2.0)) * 2.0 * progress;
  float2 grid = (pos - grainFlow) / max(cell, 1.0);
  float grainHash = hash12(floor(grid));
  float otherHash = hash12(floor(grid) + 19.0);
  float2 centre = float2(0.18 + grainHash * 0.64, 0.18 + otherHash * 0.64);
  float grain = 1.0 - smoothstep(0.04, 0.16 + 0.22 * otherHash, length(fract(grid) - centre));
  grain *= (0.45 + 0.55 * grainHash) * smoothstep(0.1, 0.25, grainHash);

  float intact = 1.0 - smoothstep(0.01, 0.4, q);
  float life = 1.0 - smoothstep(0.12, 1.0, q);
  float dust = (grain * 0.62 + cloud * cloud * 0.28) * life;
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
