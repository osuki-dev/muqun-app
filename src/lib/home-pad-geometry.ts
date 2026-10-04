/**
 * Whether Pad Home gets the cover spread (full-height cover, work column).
 * Narrower content or large type falls back to the vertical editorial page.
 */
export function padLaunchLayoutEnabled(
  contentWidth: number,
  fontScale: number,
  viewportHeight: number | undefined
): boolean {
  return contentWidth >= 752 && fontScale < 1.35 && Boolean(viewportHeight);
}

/** Width of the Pad work column beside the cover; the cover takes the rest. */
export function padWorkColumnWidth(innerWidth: number): number {
  return Math.min(400, innerWidth * 0.36);
}

/**
 * What the Pad cover column carries.
 *
 * - `artwork`: a pack's cover painting with its title (AKIBA and friends).
 * - `wordmark`: no pack, so no painting: the app's name set as large as the
 *   column allows, the way a pack's title fills its cover.
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
 * height is tight on purpose, so the block under the wordmark keeps this clear.
 */
export const PAD_WORDMARK_DESCENDER = 0.22;

/**
 * Font size for the wordmark cover: as wide as the column (the pack cover's
 * own fit and 38% cap), and never so tall that it crowds what sits under it.
 *
 * `measuredWidth` is the title's width at 100pt, 0 until it has been measured.
 * `reservedHeight` is the block below the wordmark (pair card or dock) plus its
 * breathing room; `paneHeight` is 0 until the column has been measured.
 */
export function padWordmarkFontSize({
  coverWidth,
  measuredWidth,
  paneHeight,
  reservedHeight,
}: {
  coverWidth: number;
  measuredWidth: number;
  paneHeight: number;
  reservedHeight: number;
}): number {
  const byWidth =
    measuredWidth > 0
      ? Math.min(coverWidth * 0.38, ((coverWidth - 4) * 100) / measuredWidth)
      : coverWidth * 0.25;
  if (paneHeight <= 0) return Math.max(0, byWidth);
  const byHeight =
    (paneHeight - reservedHeight) / (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER);
  return Math.max(48, Math.min(byWidth, byHeight));
}

/**
 * How much taller than wide the cover column must be before a pack's artwork
 * cover counts as portrait. A Pad in portrait gives a column about twice as
 * tall as wide; in landscape it is about square.
 */
export const PAD_PORTRAIT_COVER_RATIO = 1.25;

/**
 * Where the first-run pair card stands on the Pad cover.
 *
 * - `centred`: in the open under the cover title, vertically centred in what
 *   the title leaves. Always on the wordmark cover; on a pack's artwork cover
 *   only in portrait, where a card at the foot leaves the middle of a tall
 *   column as empty paper. The artwork stays anchored at the foot behind it.
 * - `dock`: at the column's foot. Every paired cover (that is the New-session
 *   dock), the artwork cover in landscape, where the card stands beside the
 *   figure, and the small identity cover.
 *
 * `paneHeight` is 0 until the column has been measured, which reads as
 * landscape so an unmeasured artwork cover keeps its dock.
 */
export function padFirstRunPlacement({
  coverKind,
  firstRun,
  coverWidth,
  paneHeight,
}: {
  coverKind: PadCoverKind;
  firstRun: boolean;
  coverWidth: number;
  paneHeight: number;
}): 'centred' | 'dock' {
  if (!firstRun) return 'dock';
  if (coverKind === 'wordmark') return 'centred';
  if (coverKind === 'artwork' && coverWidth > 0) {
    return paneHeight >= coverWidth * PAD_PORTRAIT_COVER_RATIO ? 'centred' : 'dock';
  }
  return 'dock';
}
