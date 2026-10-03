import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import { padLaunchLayoutEnabled, padWorkColumnWidth } from '@/lib/home-pad-geometry';

describe('padLaunchLayoutEnabled', () => {
  test('needs 752 of content width', () => {
    expect(padLaunchLayoutEnabled(751, 1, 800)).toBe(false);
    expect(padLaunchLayoutEnabled(752, 1, 800)).toBe(true);
  });
  test('large type falls back from 1.35', () => {
    expect(padLaunchLayoutEnabled(1000, 1.34, 800)).toBe(true);
    expect(padLaunchLayoutEnabled(1000, 1.35, 800)).toBe(false);
  });
  test('needs a viewport height', () => {
    expect(padLaunchLayoutEnabled(1000, 1, undefined)).toBe(false);
    expect(padLaunchLayoutEnabled(1000, 1, 0)).toBe(false);
  });
});

describe('padWorkColumnWidth', () => {
  test('a 1280dp Pad is not capped: 400 work column, 808 cover', () => {
    expect(EDITORIAL_PAD_MAX_WIDTH).toBeGreaterThanOrEqual(1280);
    const inner = getEditorialLayoutGeometry(Math.min(1280, EDITORIAL_PAD_MAX_WIDTH)).innerWidth;
    expect(inner).toBe(1232);
    expect(padWorkColumnWidth(inner)).toBe(400);
    expect(inner - padWorkColumnWidth(inner) - 24).toBe(808);
  });
  test('narrower Pads give the work column 36%', () => {
    expect(padWorkColumnWidth(1000)).toBe(360);
    expect(padWorkColumnWidth(800)).toBe(288);
  });
});
