/**
 * Whether Pad Home gets the two-column page (work left, Recent right, the dock
 * across the foot). Narrower content or large type falls back to the vertical
 * editorial page.
 */
export function padLaunchLayoutEnabled(
  contentWidth: number,
  fontScale: number,
  viewportHeight: number | undefined
): boolean {
  return contentWidth >= 752 && fontScale < 1.35 && Boolean(viewportHeight);
}

/** The gap between the two Pad columns, and between two cards in the grid. */
export const PAD_COLUMN_GAP = 24;
export const PAD_CARD_GAP = 12;

/** Narrower than this a card's rows wrap their titles to stubs; it takes the column alone. */
const PAD_CARD_MIN_WIDTH = 320;

/**
 * The two Pad columns: the work (tiles, Needs you, Computers) takes about 58%
 * of the page, Recent the rest.
 */
export function padHomeColumns(innerWidth: number): { work: number; recent: number } {
  const room = Math.max(0, innerWidth - PAD_COLUMN_GAP);
  const work = Math.round(room * 0.58);
  return { work, recent: room - work };
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
 * What the Pad band carries beside the toolbar.
 *
 * - `artwork`: a pack's cover painting; the band sets its title small and the
 *   painting is the page's backdrop (AKIBA and friends).
 * - `wordmark`: no pack, so no painting: the app's mark and name, small, over
 *   the app's own quiet texture.
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
