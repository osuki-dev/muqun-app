/**
 * Whether Pad Home gets the two-column page: the cover, the tiles and Recent
 * on the left; Needs you, the computer cards and the dock on the right.
 * Narrower content or large type falls back to the vertical editorial page.
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

/** The phone dock's gutter outside its field and its shadow, on each side and below. */
export const HOME_DOCK_OUTER_INSET = 12;
export const HOME_DOCK_OUTER_BOTTOM_INSET = 8;

/** Phone-width content cap shared by the Pad cover, launch controls and dock. */
export const HOME_PHONE_MAX_WIDTH = 430;

/**
 * The widest Home dock field on either layout: phone width minus its gutters.
 * This keeps the field and theme decoration at the same scale on Pad.
 */
export const HOME_COMPOSER_MAX_FIELD_WIDTH = HOME_PHONE_MAX_WIDTH - 2 * HOME_DOCK_OUTER_INSET;

/**
 * The inset on each side that centres a dock no wider than the phone's in a
 * Pad cover column of `coverWidth`; nothing when the column is no wider.
 */
export function padDockOuterInset(coverWidth: number): number {
  if (!Number.isFinite(coverWidth) || coverWidth <= HOME_COMPOSER_MAX_FIELD_WIDTH) return 0;
  return Math.floor((coverWidth - HOME_COMPOSER_MAX_FIELD_WIDTH) / 2);
}

/** The gap between the two Pad columns, and between two cards in the grid. */
export const PAD_COLUMN_GAP = 24;
export const PAD_CARD_GAP = 12;
export const PAD_LAUNCH_GAP = 8;
export const PAD_LAUNCH_BOTTOM_SPACE = 12;

/** Reserve the measured controls before giving the cover its preferred height.
 * Column height excludes the toolbar and stays fixed while the keyboard rises.
 */
export function padCoverAvailableHeight(
  columnHeight: number,
  composerHeight: number,
  launchesHeight: number
): number | undefined {
  if (columnHeight <= 0 || launchesHeight <= 0) return undefined;
  return Math.max(
    0,
    columnHeight - composerHeight - launchesHeight - PAD_LAUNCH_GAP - PAD_LAUNCH_BOTTOM_SPACE
  );
}

/** Narrower than this a card's rows wrap their titles to stubs; it takes the column alone. */
const PAD_CARD_MIN_WIDTH = 320;

/**
 * The cover, launch controls and dock occupy at most a phone's width at the
 * page's leading gutter. Narrow layouts retain their original 55% allocation;
 * the work column receives all remaining space after the gap.
 */
export function padHomeColumns(innerWidth: number): { cover: number; work: number } {
  const room = Math.max(0, innerWidth - PAD_COLUMN_GAP);
  const cover = Math.min(Math.round(room * 0.55), HOME_PHONE_MAX_WIDTH);
  return { cover, work: room - cover };
}

/**
 * How many columns the computer cards take in the work column: one card is
 * one wide card with the larger budget; two to four sit two abreast when each
 * still has a card's width, else they stack.
 *
 * Capping the cover column leaves more room for work on wide Pads. The same
 * minimum card width determines when that remaining space can hold two cards.
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

/** Keep the theme legible in a short window; the launch pane can scroll. */
export const PAD_COVER_MIN_HEIGHT = 200;

/**
 * The Pad cover block at the top of the left column: the pack's title and
 * painting, or the app's wordmark, prefers `PAD_COVER_SHARE` of the viewport.
 * The measured launch controls and composer take priority when space is tight.
 *
 * - `titleSize`: the cover title as wide as the column allows (the 38% cap
 *   and measured fit the cover has always used), and never taller than its
 *   share of the block: 40% of it over a painting, the whole block (with the
 *   descender) for the wordmark.
 * - `artwork`: the painting at its own proportion, standing on the block's
 *   foot at the right. Portraits beside long titles leave most of the type
 *   clear while still overlapping its lower edge. Short-title portraits keep
 *   their original frame; scenic rectangles stay behind the title.
 *
 * `measuredTitleWidth` is the title's width at 100pt, 0 until measured.
 */
export function padCover({
  viewportHeight,
  coverWidth,
  measuredTitleWidth,
  wordmark,
  foreground = true,
  hasTitle = true,
  availableHeight,
}: {
  viewportHeight: number;
  coverWidth: number;
  measuredTitleWidth: number;
  wordmark: boolean;
  /** Scenic backgrounds sit behind type; cutout portraits may overlap its lower edge. */
  foreground?: boolean;
  hasTitle?: boolean;
  /** Space left after the toolbar, measured launch controls, and composer. */
  availableHeight?: number;
}): {
  height: number;
  titleSize: number;
  titleZIndex: number;
  artwork: { width: number; height: number };
} {
  const preferredHeight = Math.round(viewportHeight * PAD_COVER_SHARE);
  const height = Math.min(
    preferredHeight,
    Math.max(PAD_COVER_MIN_HEIGHT, availableHeight ?? preferredHeight)
  );
  const byWidth =
    measuredTitleWidth > 0
      ? Math.min(coverWidth * 0.38, ((coverWidth - 4) * 100) / measuredTitleWidth)
      : coverWidth * 0.25;
  const byHeight = wordmark
    ? height / (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER)
    : (height * 0.4) / PAD_COVER_TITLE_LINE_HEIGHT;
  const titleSize = Math.max(0, Math.min(byWidth, byHeight));
  const naturalArtworkHeight = Math.min(height, coverWidth * 0.85 * COVER_ARTWORK_RATIO);
  const naturalArtworkWidth = naturalArtworkHeight / COVER_ARTWORK_RATIO;
  const titleWidth = measuredTitleWidth > 0 ? (titleSize * measuredTitleWidth) / 100 : coverWidth;
  // A short title ends before the portrait's centre and keeps the authored
  // side-by-side composition. Long titles may pass behind a silhouette, but
  // most of every letter must remain above it, even for wide heads or ears.
  const sharesTitle =
    !wordmark && hasTitle && foreground && titleWidth > coverWidth - naturalArtworkWidth / 2;
  const clearTitleHeight = sharesTitle ? titleSize * PAD_COVER_TITLE_LINE_HEIGHT * 0.78 : 0;
  const artworkHeight = Math.min(naturalArtworkHeight, Math.max(0, height - clearTitleHeight));
  return {
    height,
    titleSize,
    titleZIndex: foreground ? 0 : 2,
    artwork: {
      width: Math.round(artworkHeight / COVER_ARTWORK_RATIO),
      height: Math.round(artworkHeight),
    },
  };
}

/** The Pad page's bottom inset, with the window size it was measured at. */
export type RestingInset = { inset: number; width: number; height: number };

/**
 * The bottom inset the Pad page is sized from: only ever one measured with no
 * keyboard up. While a soft keyboard shows, or a field has focus (the inset can
 * rise before the keyboard reports itself visible), the last such measure
 * stands -- unless the window itself changed size with no keyboard up
 * (rotation, split view), when the new measure is the resting one even while a
 * field keeps focus.
 */
export function nextRestingInset(
  previous: RestingInset,
  now: RestingInset & { keyboardVisible: boolean; fieldFocused: boolean }
): RestingInset {
  if (now.keyboardVisible) return previous;
  const resized = now.width !== previous.width || now.height !== previous.height;
  if (now.fieldFocused && !resized) return previous;
  if (!resized && now.inset === previous.inset) return previous;
  return { inset: now.inset, width: now.width, height: now.height };
}
