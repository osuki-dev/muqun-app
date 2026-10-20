/**
 * Which of a theme's pictures becomes which layer of the Stage's depth
 * window. A theme does not say whether its Home artwork is a cut-out
 * character or a full painting, or whether its wallpaper is a whole scene or
 * only edges (plants, rails, a window frame) around an empty middle, so the
 * pictures' own alpha decides:
 *
 * - a full painting is the backdrop, never a rectangle standing in the scene;
 * - otherwise a full-scene wallpaper is the backdrop;
 * - a cut-out character floats in the middle as the hero;
 * - an edge-only wallpaper is the nearest layer, framing everything.
 */

/** Artwork with more than this share of clear pixels is a cut-out. */
export const STAGE_CUTOUT_CLEAR = 0.15;
/** A wallpaper with more than this share of clear pixels is only edges. */
export const STAGE_EDGES_CLEAR = 0.25;
/** Alpha at or below this (of 255) counts as clear: about 5 %, as anti-aliased fringes go. */
const CLEAR_ALPHA = 13;

/** The share of `alpha` (one byte per pixel) that is clear, 0..1; 0 for no pixels. */
export function stageClearFraction(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0;
  let clear = 0;
  for (const value of alpha) if (value <= CLEAR_ALPHA) clear += 1;
  return clear / alpha.length;
}

/**
 * A picture as the layer picker sees it: its URI, and its clear share once
 * measured -- `null` while it is still being measured. A picture that failed
 * to load is passed as absent.
 */
export type StagePicture = { uri: string; clear: number | null };

export type StageLayers = {
  /** False while a picture that might be used has not been measured yet. */
  ready: boolean;
  backdrop: string | null;
  hero: string | null;
  frame: string | null;
};

export function stageLayers({
  artwork,
  wallpaper,
}: {
  artwork?: StagePicture | null;
  wallpaper?: StagePicture | null;
}): StageLayers {
  if (artwork?.clear === null || wallpaper?.clear === null)
    return { ready: false, backdrop: null, hero: null, frame: null };
  const cutout = artwork ? (artwork.clear ?? 0) > STAGE_CUTOUT_CLEAR : false;
  const edges = wallpaper ? (wallpaper.clear ?? 0) > STAGE_EDGES_CLEAR : false;
  return {
    ready: true,
    backdrop: artwork && !cutout ? artwork.uri : wallpaper && !edges ? wallpaper.uri : null,
    hero: artwork && cutout ? artwork.uri : null,
    frame: wallpaper && edges ? wallpaper.uri : null,
  };
}
