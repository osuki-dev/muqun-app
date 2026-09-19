import { expect, test } from 'bun:test';

import { getEditorialLayoutGeometry } from '../home-editorial-layout';

test('keeps the editorial pad threshold tied to measured remaining content width', () => {
  const justNarrow = getEditorialLayoutGeometry(751, 1, true);
  const threshold = getEditorialLayoutGeometry(752, 1, true);

  expect(justNarrow.mode).toBe('one-column');
  expect(threshold.mode).toBe('two-column');
  expect(threshold.mainWidth).toBe(400);
  expect(threshold.asideWidth).toBe(280);
  expect(threshold.gap).toBe(24);
});

test('uses content width rather than a device width assumption', () => {
  expect(getEditorialLayoutGeometry(752, 1, true).mode).toBe('two-column');
  expect(getEditorialLayoutGeometry(720, 1, true).mode).toBe('one-column');
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
