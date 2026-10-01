/**
 * The amount of remaining Home content needed for the editorial main/aside
 * rhythm. It includes the two page gutters, so a 752pt Pad content area has
 * 400pt for the main column, a 280pt utility column, and a 24pt rule gap.
 */
export const EDITORIAL_TWO_COLUMN_MIN_WIDTH = 752;

/** The editorial page never grows past this; wider windows centre it. */
export const EDITORIAL_MAX_WIDTH = 1120;

/** Pad Home has no rail, so the cover may use a 1280dp tablet's full width. */
export const EDITORIAL_PAD_MAX_WIDTH = 1440;

/** On a tablet the utility column never grows past this; Continue takes the rest. */
export const EDITORIAL_PAD_ASIDE_MAX_WIDTH = 320;
const EDITORIAL_PAD_ASIDE_MIN_WIDTH = 240;

export type EditorialLayoutMode = 'one-column' | 'two-column';

export type EditorialLayoutGeometry = {
  mode: EditorialLayoutMode;
  contentWidth: number;
  innerWidth: number;
  gutter: number;
  gap: number;
  mainWidth: number;
  asideWidth: number;
};

/**
 * Resolve the editorial page grid from the width the parent measured after its
 * own navigation was removed. Large type keeps the page in one reading column
 * until the utility column has enough room to stay useful.
 */
export function getEditorialLayoutGeometry(
  contentWidth: number,
  fontScale = 1,
  hasAside = true,
  pad = false
): EditorialLayoutGeometry {
  const width = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const gutter = width >= EDITORIAL_TWO_COLUMN_MIN_WIDTH ? 24 : 12;
  const innerWidth = Math.max(0, width - gutter * 2);
  const wideTypeMinimum = EDITORIAL_TWO_COLUMN_MIN_WIDTH + Math.max(0, scale - 1) * 320;
  const twoColumn =
    hasAside && scale < 1.35 && width >= wideTypeMinimum && innerWidth >= gutter * 2;
  const gap = twoColumn ? Math.min(32, Math.max(24, Math.round(24 * scale))) : 0;
  const asideWidth = !twoColumn
    ? 0
    : pad
      ? Math.min(
          EDITORIAL_PAD_ASIDE_MAX_WIDTH,
          Math.max(EDITORIAL_PAD_ASIDE_MIN_WIDTH, Math.round(innerWidth * 0.28))
        )
      : Math.min(340, Math.max(280, Math.round(280 * scale)));
  const mainWidth = twoColumn ? Math.max(0, innerWidth - gap - asideWidth) : innerWidth;

  return {
    mode: twoColumn ? 'two-column' : 'one-column',
    contentWidth: width,
    innerWidth,
    gutter,
    gap,
    mainWidth,
    asideWidth,
  };
}
