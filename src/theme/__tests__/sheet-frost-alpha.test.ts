import { expect, test } from 'bun:test';

import { SHEET_FROST_ALPHA, sheetFrostAlpha } from '../surface-background';

test('the sheet frost follows the opacity slider down to its legibility floor', () => {
  expect(SHEET_FROST_ALPHA).toBe(0.82);
  expect(sheetFrostAlpha(1)).toBe(1);
  expect(sheetFrostAlpha(0.9)).toBe(0.9);
  expect(sheetFrostAlpha(0.5)).toBe(0.82);
  expect(sheetFrostAlpha(0)).toBe(0.82);
  expect(sheetFrostAlpha(Number.NaN)).toBe(1);
  expect(sheetFrostAlpha(undefined as unknown as number)).toBe(1);
});
