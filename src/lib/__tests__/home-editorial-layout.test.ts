import { expect, test } from 'bun:test';

import { getEditorialLayoutGeometry, editorialScenePlacement } from '../home-editorial-layout';

test('keeps the editorial pad threshold tied to measured remaining content width', () => {
  const justNarrow = getEditorialLayoutGeometry(751, 1, true);
  const threshold = getEditorialLayoutGeometry(752, 1, true);

  expect(justNarrow.mode).toBe('one-column');
  expect(threshold.mode).toBe('two-column');
  expect(threshold.mainWidth).toBe(400);
  expect(threshold.asideWidth).toBe(280);
  expect(threshold.gap).toBe(24);
});

test('a Pad Home keeps Connections narrow and gives Continue the rest', () => {
  const pad = getEditorialLayoutGeometry(980, 1, true, true);
  expect(pad.mode).toBe('two-column');
  expect(pad.asideWidth).toBe(261);
  expect(pad.mainWidth).toBe(932 - 24 - 261);
  // Never wider than 320, whatever the width or the type size.
  expect(getEditorialLayoutGeometry(2000, 1, true, true).asideWidth).toBe(320);
  expect(getEditorialLayoutGeometry(1600, 1.3, true, true).asideWidth).toBeLessThanOrEqual(320);
  // The phone and every non-Pad caller keep the old utility column.
  expect(getEditorialLayoutGeometry(980, 1, true).asideWidth).toBe(280);
});

test('collapses to one column as type grows', () => {
  expect(getEditorialLayoutGeometry(752, 1.2, true).mode).toBe('one-column');
  expect(getEditorialLayoutGeometry(1200, 1.35, true).mode).toBe('one-column');
  expect(getEditorialLayoutGeometry(1200, 1.25, true).mode).toBe('two-column');
});

test('normalizes invalid widths without producing negative geometry', () => {
  for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -100]) {
    const geometry = getEditorialLayoutGeometry(width, 1, true);
    expect(geometry.mode).toBe('one-column');
    expect(geometry.contentWidth).toBe(0);
    expect(geometry.innerWidth).toBe(0);
    expect(geometry.mainWidth).toBe(0);
    expect(geometry.asideWidth).toBe(0);
  }
});

test('stays one column when the utility slots are absent', () => {
  const geometry = getEditorialLayoutGeometry(1200, 1, false);

  expect(geometry.mode).toBe('one-column');
  expect(geometry.asideWidth).toBe(0);
  expect(geometry.gap).toBe(0);
  expect(geometry.mainWidth).toBe(1152);
});

test('scenes reach the status bar without moving the launch tiles or controls', () => {
  for (const safeTop of [0, 24, 48, 59]) {
    for (const titleHeight of [0, 48, 120, 240]) {
      const topInset = safeTop + 12;
      const placement = editorialScenePlacement(titleHeight, topInset);
      expect(topInset + titleHeight + placement.marginTop).toBe(0);
      // The former foreground overlap determines the slot's total contribution.
      expect(placement.marginTop + placement.marginBottom).toBeCloseTo(-titleHeight * 0.35);
      // Title and toolbar positions never consume the artwork's negative margin.
      expect(topInset).toBeGreaterThanOrEqual(safeTop);
    }
  }
});
