/**
 * The amount of remaining Home content needed for the editorial main/aside
 * rhythm. It includes the two page gutters, so a 752pt Pad content area has
 * 400pt for the main column, a 280pt utility column, and a 24pt rule gap.
 */
export const EDITORIAL_TWO_COLUMN_MIN_WIDTH = 752;

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
  hasAside = true
): EditorialLayoutGeometry {
  const width = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const gutter = width >= EDITORIAL_TWO_COLUMN_MIN_WIDTH ? 24 : 12;
  const innerWidth = Math.max(0, width - gutter * 2);
  const wideTypeMinimum = EDITORIAL_TWO_COLUMN_MIN_WIDTH + Math.max(0, scale - 1) * 320;
  const twoColumn =
    hasAside && scale < 1.35 && width >= wideTypeMinimum && innerWidth >= gutter * 2;
  const gap = twoColumn ? Math.min(32, Math.max(24, Math.round(24 * scale))) : 0;
  const asideWidth = twoColumn ? Math.min(340, Math.max(280, Math.round(280 * scale))) : 0;
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
