/**
 * The opening's exit: the picture breaks into small tiles that drift away and
 * fade, and Home is what is left.
 *
 * The launch scene's rule is that nothing ever covers the artwork. An exit
 * that faded a plane over it, or the whole sheet out at once, would still be
 * something happening *to* the picture from outside. This one is the picture
 * itself coming apart: a snapshot of the finished composition is cut into a
 * grid, and each tile leaves on its own schedule -- swept from left to right
 * with a little jitter, so the frame is eaten away rather than vanishing
 * uniformly -- lifting up and to the right like dust in wind.
 *
 * Everything here is arithmetic on numbers, free of React, React Native,
 * Reanimated and Skia, so `bun test` can load it (see the note atop
 * `motion-tokens.test.ts`). The per-frame functions carry the `'worklet'`
 * directive so the component can call them on the UI thread inside the
 * Atlas's transform and colour buffers; outside Metro the directive is an
 * inert string. The component only maps these numbers onto `RSXform`s.
 */

/** Tile edge in points: small enough to read as dust on a phone. */
export const SNAP_TILE_PHONE = 18;

/** And on a tablet, where 18 would be four thousand tiles for no visible gain. */
export const SNAP_TILE_TABLET = 24;

/** A window whose shorter side is at least this many points is a tablet here. */
export const SNAP_TABLET_MIN_SIDE = 600;

/** The ceiling on sprites in the one Atlas draw; the tile grows past it rather than the count. */
export const SNAP_MAX_TILES = 4000;

/** How much of the exit the left-to-right sweep takes, as a fraction of a tile's start. */
export const SNAP_SWEEP = 0.55;

/** How much each tile's own hash staggers its start on top of the sweep. */
export const SNAP_JITTER = 0.25;

/** How long one tile takes to leave, in the same units. */
export const SNAP_TILE_SPAN = 0.45;

/**
 * The last moment any tile can still be moving, in those units.
 *
 * Start times run up to `SWEEP + JITTER` and each tile then takes `SPAN`, so
 * on the raw schedule the rightmost tiles would still be a third visible when
 * the exit's clock reads 1. The clock is stretched by this so that the last
 * tile is gone exactly when the overlay finishes -- otherwise the end of the
 * snap would be a cut.
 */
export const SNAP_END = SNAP_SWEEP + SNAP_JITTER + SNAP_TILE_SPAN;

/** The drift at the end of a tile's travel, in points: `base + range * hash`. */
export const SNAP_DRIFT = {
  x: { base: 40, range: 60 },
  y: { base: 90, range: 70 },
} as const;

/** The sideways curl riding the drift, in points. */
export const SNAP_CURL = 12;

/** The most a tile turns, in radians, either way. */
export const SNAP_TURN = 0.9;

/** How far through its departure a tile stays fully opaque before it fades. */
export const SNAP_HOLD = 0.6;

/** How much a tile shrinks by the time it is gone. */
export const SNAP_SHRINK = 0.35;

/** The grid laid over the snapshot, in points. */
export type SnapGrid = {
  width: number;
  height: number;
  tile: number;
  cols: number;
  rows: number;
  count: number;
};

/** One tile: where it sits (points), its hash, and how far across the sweep it is. */
export type SnapTile = {
  x: number;
  y: number;
  w: number;
  h: number;
  hash: number;
  /** The tile centre's x as a fraction of the grid's width, in [0, 1]. */
  sweep: number;
};

/** One sprite's placement: the `RSXform` four, plus the alpha its colour carries. */
export type SnapTransform = {
  scos: number;
  ssin: number;
  tx: number;
  ty: number;
  alpha: number;
};

/** The tile size for a window: phone or tablet, before the count cap. */
export function snapTileSize(width: number, height: number): number {
  return Math.min(width, height) >= SNAP_TABLET_MIN_SIDE ? SNAP_TILE_TABLET : SNAP_TILE_PHONE;
}

/**
 * A grid of `tile`-point squares covering `width` x `height`, the last row and
 * column cut to the edge. If that would be more than {@link SNAP_MAX_TILES}
 * sprites, the tile grows until it is not.
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
 * A tile's own number in [0, 1), from its grid index: a small integer hash
 * (lowbias32), so the scatter is the same on every launch and nothing calls
 * `Math.random` on the UI thread.
 */
export function snapTileHash(index: number): number {
  'worklet';
  let x = (index + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** The tile at `index`, row-major. Allocates only when `out` is not given. */
export function snapTile(grid: SnapGrid, index: number, out?: SnapTile): SnapTile {
  'worklet';
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  const x = col * grid.tile;
  const y = row * grid.tile;
  const w = Math.min(grid.tile, grid.width - x);
  const h = Math.min(grid.tile, grid.height - y);
  const tile = out ?? { x: 0, y: 0, w: 0, h: 0, hash: 0, sweep: 0 };
  tile.x = x;
  tile.y = y;
  tile.w = w;
  tile.h = h;
  tile.hash = snapTileHash(index);
  tile.sweep = grid.width > 0 ? Math.min(1, Math.max(0, (x + w / 2) / grid.width)) : 0;
  return tile;
}

/** How far through its own departure a tile is at exit progress `p`, before easing. */
export function snapTileProgress(tile: SnapTile, p: number): number {
  'worklet';
  const start = SNAP_SWEEP * tile.sweep + SNAP_JITTER * tile.hash;
  const q = (p * SNAP_END - start) / SNAP_TILE_SPAN;
  return q <= 0 ? 0 : q >= 1 ? 1 : q;
}

/**
 * Where a tile is drawn at exit progress `p` in [0, 1].
 *
 * `scos`/`ssin`/`tx`/`ty` are an `RSXform` mapping the tile's sprite -- which
 * is `pixelRatio` times its size in points, being cut from a snapshot taken at
 * device resolution -- onto the canvas in points, rotating and shrinking it
 * about its own centre. At `p = 0` every tile is exactly where it was cut
 * from, and at `p = 1` every tile's alpha is 0.
 *
 * The curl is measured from where it starts (`sin(2pi h)`), so a tile at rest
 * has not been nudged sideways before it has begun to move.
 */
export function snapTileTransform(
  tile: SnapTile,
  p: number,
  pixelRatio = 1,
  out?: SnapTransform
): SnapTransform {
  'worklet';
  const q = snapTileProgress(tile, p);
  const left = 1 - q;
  const e = 1 - left * left * left;
  const hash = tile.hash;
  const dx =
    e * (SNAP_DRIFT.x.base + SNAP_DRIFT.x.range * hash) +
    SNAP_CURL * (Math.sin(6.283185307179586 * (hash + e)) - Math.sin(6.283185307179586 * hash));
  const dy = -e * (SNAP_DRIFT.y.base + SNAP_DRIFT.y.range * hash);
  const theta = (hash - 0.5) * SNAP_TURN * e;
  const scale = 1 - SNAP_SHRINK * e;
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const scos = (Math.cos(theta) * scale) / ratio;
  const ssin = (Math.sin(theta) * scale) / ratio;
  // The sprite's own centre, in sprite pixels, and where it lands, in points.
  const halfW = (tile.w * ratio) / 2;
  const halfH = (tile.h * ratio) / 2;
  const cx = tile.x + tile.w / 2 + dx;
  const cy = tile.y + tile.h / 2 + dy;
  const result = out ?? { scos: 0, ssin: 0, tx: 0, ty: 0, alpha: 0 };
  result.scos = scos;
  result.ssin = ssin;
  result.tx = cx - (scos * halfW - ssin * halfH);
  result.ty = cy - (ssin * halfW + scos * halfH);
  // Solid while it is carried away -- the picture leaves, it does not thin
  // out where it stands, so what shows through is Home where a tile has gone
  // -- and only then fades, easing out, to nothing by the end of its travel.
  const fade = q <= SNAP_HOLD ? 0 : (q - SNAP_HOLD) / (1 - SNAP_HOLD);
  result.alpha = (1 - fade) * (1 - fade);
  return result;
}
