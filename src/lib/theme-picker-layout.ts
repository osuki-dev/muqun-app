export const THEME_PICKER_GRID_GAP = 8;
export const THEME_PICKER_TWO_COLUMN_MIN_WIDTH = 320;
export const THEME_PICKER_THREE_COLUMN_MIN_WIDTH = 720;
export const THEME_PICKER_FOUR_COLUMN_MIN_WIDTH = 960;
export const THEME_PICKER_MAX_CONTENT_WIDTH = 1040;

export type ThemePickerGridLayout = {
  columns: 1 | 2 | 3 | 4;
  itemWidth: number;
};

/**
 * Sizes the picker from the sheet's actual content width, not device identity.
 * Two compact columns keep phone scanning fast; Pad gains a column whenever
 * every card can still keep its two mode previews comfortably readable.
 */
export function themePickerGridLayout(availableWidth: number): ThemePickerGridLayout {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const columns =
    safeWidth >= THEME_PICKER_FOUR_COLUMN_MIN_WIDTH
      ? 4
      : safeWidth >= THEME_PICKER_THREE_COLUMN_MIN_WIDTH
        ? 3
        : safeWidth >= THEME_PICKER_TWO_COLUMN_MIN_WIDTH
          ? 2
          : 1;
  const itemWidth = Math.max(0, (safeWidth - THEME_PICKER_GRID_GAP * (columns - 1)) / columns);

  return { columns, itemWidth };
}
