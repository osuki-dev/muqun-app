import { describe, expect, test } from 'bun:test';

import {
  PANEL_PICKER_GRID_GAP,
  PANEL_PICKER_HORIZONTAL_PADDING,
  panelPickerGridLayout,
} from '@/lib/panel-picker-layout';

describe('panel picker grid layout', () => {
  test('keeps compact sheets in the existing single column', () => {
    expect(panelPickerGridLayout(719)).toEqual({
      columns: 1,
      contentWidth: 719 - PANEL_PICKER_HORIZONTAL_PADDING * 2,
      itemWidth: 719 - PANEL_PICKER_HORIZONTAL_PADDING * 2,
    });
  });

  test('uses two columns from the Pad breakpoint', () => {
    const layout = panelPickerGridLayout(720);
    expect(layout.columns).toBe(2);
    expect(layout.itemWidth).toBe(
      (layout.contentWidth - PANEL_PICKER_GRID_GAP) / 2
    );
  });

  test('uses three columns when each card remains phone-width', () => {
    const layout = panelPickerGridLayout(1080);
    expect(layout.columns).toBe(3);
    expect(layout.itemWidth).toBe(
      (layout.contentWidth - PANEL_PICKER_GRID_GAP * 2) / 3
    );
    expect(layout.itemWidth).toBeGreaterThanOrEqual(340);
  });

  test('sanitizes invalid and negative measurements', () => {
    expect(panelPickerGridLayout(Number.NaN)).toEqual({
      columns: 1,
      contentWidth: 0,
      itemWidth: 0,
    });
    expect(panelPickerGridLayout(-200)).toEqual({
      columns: 1,
      contentWidth: 0,
      itemWidth: 0,
    });
  });
});
