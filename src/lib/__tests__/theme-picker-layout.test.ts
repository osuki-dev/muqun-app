import { describe, expect, test } from 'bun:test';

import { THEME_PICKER_GRID_GAP, themePickerGridLayout } from '@/lib/theme-picker-layout';

describe('theme picker grid layout', () => {
  test('keeps very narrow split views in one column', () => {
    expect(themePickerGridLayout(319)).toEqual({ columns: 1, itemWidth: 319 });
  });

  test('uses two columns on a normal phone sheet', () => {
    const layout = themePickerGridLayout(354);
    expect(layout.columns).toBe(2);
    expect(layout.itemWidth).toBe((354 - THEME_PICKER_GRID_GAP) / 2);
  });

  test('adds a third column at the Pad breakpoint', () => {
    const layout = themePickerGridLayout(720);
    expect(layout.columns).toBe(3);
    expect(layout.itemWidth).toBe((720 - THEME_PICKER_GRID_GAP * 2) / 3);
  });

  test('uses four columns in a full-width Pad sheet', () => {
    const layout = themePickerGridLayout(960);
    expect(layout.columns).toBe(4);
    expect(layout.itemWidth).toBe((960 - THEME_PICKER_GRID_GAP * 3) / 4);
  });

  test('sanitizes invalid and negative measurements', () => {
    expect(themePickerGridLayout(Number.NaN)).toEqual({ columns: 1, itemWidth: 0 });
    expect(themePickerGridLayout(-200)).toEqual({ columns: 1, itemWidth: 0 });
  });
});
