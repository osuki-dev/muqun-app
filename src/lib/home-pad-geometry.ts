/**
 * Whether Pad Home gets the two-column page (the cover, the tiles and Recent
 * on the left; Needs you, the computer cards and the dock on the right). Narrower content or large type falls
 * back to the vertical editorial page.
 */
export function padLaunchLayoutEnabled(
  contentWidth: number,
  fontScale: number,
  viewportHeight: number | undefined
): boolean {
  return contentWidth >= 752 && fontScale < 1.35 && Boolean(viewportHeight);
}

/** The Pad cover dock's field, empty: room for a paragraph, not one line. */
export const PAD_DOCK_FIELD_LINES = 3;

/** The gap between the two Pad columns, and between two cards in the grid. */
export const PAD_COLUMN_GAP = 24;
export const PAD_CARD_GAP = 12;

/** Narrower than this a card's rows wrap their titles to stubs; it takes the column alone. */
const PAD_CARD_MIN_WIDTH = 320;

/**
 * The two Pad columns (design §8 Pad, revised): the cover, the tiles and
 * Recent take about 55% of the page on the left; the work -- Needs you, the
 * computer cards and the dock -- the rest on the right.
 */
export function padHomeColumns(innerWidth: number): { cover: number; work: number } {
  const room = Math.max(0, innerWidth - PAD_COLUMN_GAP);
  const cover = Math.round(room * 0.55);
  return { cover, work: room - cover };
}

/**
 * How many columns the computer cards take in the work column: one card is
 * one wide card with the larger budget; two to four sit two abreast when each
 * still has a card's width, else they stack.
 */
export function padCardColumns(workWidth: number, cards: number): 1 | 2 {
  return cards >= 2 && workWidth >= PAD_CARD_MIN_WIDTH * 2 + PAD_CARD_GAP ? 2 : 1;
}

/**
 * What the Pad cover block carries at the top of the work column.
 *
 * - `artwork`: a pack's cover painting with its title (AKIBA and friends).
 * - `wordmark`: no pack, so no painting: the app's name set as large as the
 *   block allows, over the app's own quiet texture.
 * - `identity`: anything else keeps the small identity block it had.
 */
export type PadCoverKind = 'artwork' | 'wordmark' | 'identity';

export function padCoverKind({
  cover,
  hasArtwork,
  typographic,
  hasTitle,
}: {
  cover: boolean;
  hasArtwork: boolean;
  /** The parent found no theme pack, so the cover is the app's own. */
  typographic: boolean;
  hasTitle: boolean;
}): PadCoverKind {
  if (cover && hasArtwork) return 'artwork';
  if (typographic && !hasArtwork && hasTitle) return 'wordmark';
  return 'identity';
}

/** Line height of a cover title, as a multiple of its font size. */
export const PAD_COVER_TITLE_LINE_HEIGHT = 1.08;

/**
 * How far a descender (the q in "Muqun") hangs below that line box. The line
 * height is tight on purpose, so the wordmark's cover keeps this clear.
 */
export const PAD_WORDMARK_DESCENDER = 0.22;

/** The cover painting's own proportion: as tall as 0.9 of its width (`HomeEditorialArtwork`). */
const COVER_ARTWORK_RATIO = 0.9;

/** The cover block's share of the viewport. */
export const PAD_COVER_SHARE = 0.45;

/**
 * The Pad cover block at the top of the left column: the pack's title and
 * painting, or the app's wordmark, always at `PAD_COVER_SHARE` of the
 * viewport -- the work sits in the other column, so nothing makes it smaller.
 *
 * - `titleSize`: the cover title as wide as the column allows (the 38% cap
 *   and measured fit the cover has always used), and never taller than its
 *   share of the block: 40% of it over a painting, the whole block (with the
 *   descender) for the wordmark.
 * - `artwork`: the painting at its own proportion in the full block,
 *   standing on the block's foot at the right, as wide as 85% of the column
 *   at most, so the title's start stays clear at its left.
 *
 * `measuredTitleWidth` is the title's width at 100pt, 0 until measured.
 */
export function padCover({
  viewportHeight,
  coverWidth,
  measuredTitleWidth,
  wordmark,
}: {
  viewportHeight: number;
  coverWidth: number;
  measuredTitleWidth: number;
  wordmark: boolean;
}): { height: number; titleSize: number; artwork: { width: number; height: number } } {
  const height = Math.round(viewportHeight * PAD_COVER_SHARE);
  const byWidth =
    measuredTitleWidth > 0
      ? Math.min(coverWidth * 0.38, ((coverWidth - 4) * 100) / measuredTitleWidth)
      : coverWidth * 0.25;
  const byHeight = wordmark
    ? height / (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER)
    : (height * 0.4) / PAD_COVER_TITLE_LINE_HEIGHT;
  const artworkHeight = Math.min(height, coverWidth * 0.85 * COVER_ARTWORK_RATIO);
  return {
    height,
    titleSize: Math.max(0, Math.min(byWidth, byHeight)),
    artwork: {
      width: Math.round(artworkHeight / COVER_ARTWORK_RATIO),
      height: Math.round(artworkHeight),
    },
  };
}
