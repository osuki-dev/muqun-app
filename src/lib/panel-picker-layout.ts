export const PANEL_PICKER_GRID_MIN_WIDTH = 720;
export const PANEL_PICKER_THREE_COLUMN_MIN_WIDTH = 1080;
export const PANEL_PICKER_GRID_GAP = 14;
export const PANEL_PICKER_HORIZONTAL_PADDING = 16;

export type PanelPickerGridLayout = {
  columns: 1 | 2 | 3;
  contentWidth: number;
  itemWidth: number;
};

/**
 * Sizes tab groups from the sheet's measured width, not from device identity.
 * The breakpoints keep every grid card at least as wide as the existing phone
 * card, so its row actions and two-line panel labels retain their compact fit.
 */
export function panelPickerGridLayout(availableWidth: number): PanelPickerGridLayout {
  const safeWidth = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const contentWidth = Math.max(0, safeWidth - PANEL_PICKER_HORIZONTAL_PADDING * 2);
  const columns =
    safeWidth >= PANEL_PICKER_THREE_COLUMN_MIN_WIDTH
      ? 3
      : safeWidth >= PANEL_PICKER_GRID_MIN_WIDTH
        ? 2
        : 1;
  const itemWidth = Math.max(0, (contentWidth - PANEL_PICKER_GRID_GAP * (columns - 1)) / columns);

  return { columns, contentWidth, itemWidth };
}
