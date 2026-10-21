/**
 * How the Stage presents a theme: which picture becomes which layer of the
 * depth window, decided from what the theme author chose for the 2D Home
 * (`homePresentation.header`, each slot's fit, focal point and opacity) and
 * from what the pictures are (their alpha: a cut-out character or a whole
 * painting; a full-scene wallpaper or only edges around an empty middle).
 *
 * Four roles, one per kind of theme:
 *
 * - **sky** -- a cover header over an opaque painting. The painting is a
 *   width-fit band at the top, as the 2D cover shows it, feathered into the
 *   wallpaper's base; the HUD keeps the authored sky open.
 * - **figure** -- a cover header over a cut-out. The figure stands in the 2D
 *   cover box, tucked under the computer's name, in front of the wallpaper.
 * - **inset** -- a standard header with artwork. A smaller picture in the
 *   standard band just below the HUD, in front of the wallpaper.
 * - **world** -- no artwork (hidden by the author or the reader, or absent).
 *   The wallpaper is the whole world.
 *
 * In every role an edge-only wallpaper is the nearest layer, framing the
 * world, and a full-scene one is the deepest; both keep their authored
 * opacity.
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

export type StageFocal = { x: number; y: number };
export type StageFit = 'cover' | 'contain' | 'tile';

/**
 * A theme picture as the Stage receives it: the resolved slot (asset, fit,
 * focal point, opacity) and what measuring it found -- its clear share and
 * shape, `null` while it is still being measured. A picture that failed to
 * load is passed as absent.
 */
export type StageMeasuredImage = {
  uri: string;
  clear: number | null;
  /** Width over height; 1 until measured. */
  aspect?: number;
  fit?: StageFit;
  focal?: StageFocal;
  opacity?: number;
};

export type StageRole = 'sky' | 'figure' | 'inset' | 'world';

/** A layer: the picture and how the author asked for it to be drawn. */
export type StageLayer = {
  uri: string;
  aspect: number;
  /** As authored; the artwork's absent fit means what Editorial makes of it. */
  fit: StageFit | undefined;
  /** CSS `object-position`, 0..1 from the top left. */
  focal: StageFocal;
  opacity: number;
};

/** How the artwork's edges dissolve into the world behind it. */
export type StageArtFeather =
  /** The 2D cover: the bottom fades from 68 % of the box. */
  | 'cover'
  /** A standard cut-out: the bottom fades from 72 % of the band. */
  | 'inset'
  /** A standard painting: a framed picture whose every edge dissolves. */
  | 'framed';

export type StageHeroLayer = StageLayer & {
  /** Which 2D box the figure stands in. */
  box: 'cover' | 'standard';
  feather: StageArtFeather;
  /** A cut-out gets a soft glow behind it; a framed picture does not. */
  cutout: boolean;
};

export type StageComposition = {
  /** False while a picture that might be used has not been measured yet. */
  ready: boolean;
  role: StageRole;
  /** The deepest layer: a full-scene wallpaper, cover or contain fitted. */
  backdrop: StageLayer | null;
  /** The sky role's painting: a width-fit band across the top. */
  painting: StageLayer | null;
  hero: StageHeroLayer | null;
  /** An edge-only wallpaper, nearest in depth, drawn behind the cores. */
  frame: StageLayer | null;
};

const CENTRE: StageFocal = { x: 0.5, y: 0.5 };

function finite(value: number | undefined, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function layerOf(picture: StageMeasuredImage): StageLayer {
  return {
    uri: picture.uri,
    aspect: picture.aspect && picture.aspect > 0 ? picture.aspect : 1,
    fit: picture.fit,
    focal: picture.focal
      ? { x: finite(picture.focal.x, 0.5, 0, 1), y: finite(picture.focal.y, 0.5, 0, 1) }
      : CENTRE,
    opacity: finite(picture.opacity, 1, 0, 1),
  };
}

/** The Stage's layers for a theme; see the module comment for the four roles. */
export function stageComposition({
  coverHeader,
  artwork,
  wallpaper,
}: {
  /** `homePresentation.header === 'cover'`. */
  coverHeader: boolean;
  artwork?: StageMeasuredImage | null;
  wallpaper?: StageMeasuredImage | null;
}): StageComposition {
  const art = artwork ?? null;
  const wall = wallpaper ?? null;
  const cutout = art ? (art.clear ?? 0) > STAGE_CUTOUT_CLEAR : false;
  const role: StageRole = !art ? 'world' : coverHeader ? (cutout ? 'figure' : 'sky') : 'inset';
  if (art?.clear === null || wall?.clear === null)
    return { ready: false, role, backdrop: null, painting: null, hero: null, frame: null };
  const edges = wall ? (wall.clear ?? 0) > STAGE_EDGES_CLEAR : false;
  const artLayer = art ? layerOf(art) : null;
  return {
    ready: true,
    role,
    backdrop: wall && !edges ? layerOf(wall) : null,
    painting: role === 'sky' ? artLayer : null,
    hero:
      artLayer && role !== 'sky'
        ? {
            ...artLayer,
            box: role === 'figure' ? 'cover' : 'standard',
            feather: role === 'figure' ? 'cover' : cutout ? 'inset' : 'framed',
            cutout,
          }
        : null,
    frame: wall && edges ? layerOf(wall) : null,
  };
}
