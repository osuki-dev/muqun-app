import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import {
  fitArtworkBox,
  padHeroHeight,
  padHeroSplit,
  padLaunchLayoutEnabled,
  padLowerBandLayout,
} from '@/lib/home-pad-geometry';

describe('padLowerBandLayout', () => {
  test('wide pad gives two continue columns and a 320 connections column', () => {
    const l = padLowerBandLayout(1500);
    expect(l.columns).toBe(2);
    expect(l.connectionsWidth).toBe(320);
    expect(l.continueWidth + l.gap + l.connectionsWidth).toBe(1500);
  });
  test('narrow content falls back to one column and stacks connections', () => {
    const l = padLowerBandLayout(740);
    expect(l.columns).toBe(1);
    expect(l.connectionsWidth).toBe(740);
    expect(l.continueWidth).toBe(740);
  });
});

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

describe('Pad width cap', () => {
  test('a 1280dp Pad is not capped and keeps two band columns', () => {
    expect(EDITORIAL_PAD_MAX_WIDTH).toBeGreaterThanOrEqual(1280);
    const inner = getEditorialLayoutGeometry(Math.min(1280, EDITORIAL_PAD_MAX_WIDTH)).innerWidth;
    expect(inner).toBe(1232);
    expect(padLowerBandLayout(inner).columns).toBe(2);
  });
});

describe('padHeroHeight', () => {
  // min(0.58h, h - 300), floored at 440 from a 740 viewport; below 740 the floor
  // would crowd out the band, so it is h - 300, never under 320.
  test('800 viewport: 58% of the height, leaving the band 336', () => {
    expect(padHeroHeight(800)).toBeCloseTo(464);
  });
  test('1366 viewport: 58% of the height', () => {
    expect(padHeroHeight(1366)).toBeCloseTo(792.28);
  });
  test('740 is where the 440 floor starts to apply', () => {
    expect(padHeroHeight(740)).toBe(440);
    expect(padHeroHeight(739)).toBe(439);
  });
  test('short viewports leave 300 for the band, never under 320', () => {
    expect(padHeroHeight(700)).toBe(400);
    expect(padHeroHeight(600)).toBe(320);
  });
});

describe('padHeroSplit', () => {
  // omarchy-pad 1280x800: viewport after insets ~750 -> hero 440; cover column
  // 848 wide, so the width-fitted title could be 0.38 * 848 * 1.08 = 348 tall.
  test('a short hero caps the title at 30% and leaves the drawing >= 60%', () => {
    const split = padHeroSplit(440, 348, true);
    expect(split.titleHeight).toBeCloseTo(132);
    expect(split.artworkMaxHeight).toBeCloseTo(440 - 0.65 * 132);
    expect(split.artworkMaxHeight / 440).toBeGreaterThanOrEqual(0.6);
  });
  test('from a 520 hero the title may take 40%', () => {
    const split = padHeroSplit(600, 348, true);
    expect(split.titleHeight).toBeCloseTo(240);
    expect(split.artworkMaxHeight).toBeCloseTo(600 - 0.65 * 240);
  });
  test('a title that already fits keeps its size', () => {
    expect(padHeroSplit(600, 100, true).titleHeight).toBe(100);
  });
  test('without a title the drawing gets the whole hero', () => {
    expect(padHeroSplit(440, 348, false)).toEqual({ titleHeight: 0, artworkMaxHeight: 440 });
  });
});

describe('fitArtworkBox', () => {
  test('without a cap the natural box is kept', () => {
    expect(fitArtworkBox(848, 640, undefined)).toEqual({ width: 848, height: 640 });
    expect(fitArtworkBox(848, 640, 700)).toEqual({ width: 848, height: 640 });
  });
  test('a cap scales the whole box down, so the composition is never cropped', () => {
    const box = fitArtworkBox(848, 640, 354.2);
    expect(box.height).toBeCloseTo(354.2);
    expect(box.width).toBeCloseTo((848 * 354.2) / 640);
    expect(box.width / box.height).toBeCloseTo(848 / 640);
  });
  test('a zero-width layout stays empty', () => {
    expect(fitArtworkBox(0, 0, 300)).toEqual({ width: 0, height: 0 });
  });
});
