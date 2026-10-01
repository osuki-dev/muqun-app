import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import { padHeroHeight, padLaunchLayoutEnabled, padLowerBandLayout } from '@/lib/home-pad-geometry';

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
