import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import {
  PAD_COVER_TITLE_LINE_HEIGHT,
  PAD_WORDMARK_DESCENDER,
  padCoverKind,
  padLaunchLayoutEnabled,
  padWordmarkFontSize,
  padWorkColumnWidth,
} from '@/lib/home-pad-geometry';

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

describe('padCoverKind', () => {
  const base = { cover: false, hasArtwork: false, typographic: false, hasTitle: true };
  test("a pack's cover painting always wins, typographic or not", () => {
    expect(padCoverKind({ ...base, cover: true, hasArtwork: true })).toBe('artwork');
    expect(padCoverKind({ ...base, cover: true, hasArtwork: true, typographic: true })).toBe(
      'artwork'
    );
  });
  test('no pack and no painting sets the wordmark', () => {
    expect(padCoverKind({ ...base, typographic: true })).toBe('wordmark');
  });
  test('a pack without a cover painting keeps its identity block', () => {
    expect(padCoverKind(base)).toBe('identity');
    expect(padCoverKind({ ...base, hasArtwork: true })).toBe('identity');
  });
  test('no wordmark without a title, or over artwork', () => {
    expect(padCoverKind({ ...base, typographic: true, hasTitle: false })).toBe('identity');
    expect(padCoverKind({ ...base, typographic: true, hasArtwork: true })).toBe('identity');
  });
});

describe('padWordmarkFontSize', () => {
  test('before measuring: a quarter of the column', () => {
    expect(
      padWordmarkFontSize({ coverWidth: 800, measuredWidth: 0, paneHeight: 0, reservedHeight: 0 })
    ).toBe(200);
  });
  test('fits the measured title to the column, capped at 38%', () => {
    // 300 at 100pt fills 796 at about 265.
    expect(
      padWordmarkFontSize({ coverWidth: 800, measuredWidth: 300, paneHeight: 0, reservedHeight: 0 })
    ).toBeCloseTo(265.33, 1);
    expect(
      padWordmarkFontSize({ coverWidth: 800, measuredWidth: 100, paneHeight: 0, reservedHeight: 0 })
    ).toBe(304);
  });
  test('a short column gives the block below it room first', () => {
    const size = padWordmarkFontSize({
      coverWidth: 800,
      measuredWidth: 300,
      paneHeight: 600,
      reservedHeight: 380,
    });
    // The line box and the descender together take what the block leaves.
    expect(size * (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER)).toBeCloseTo(220, 5);
  });
  test('a tall column leaves the width fit alone', () => {
    expect(
      padWordmarkFontSize({
        coverWidth: 800,
        measuredWidth: 300,
        paneHeight: 900,
        reservedHeight: 380,
      })
    ).toBeCloseTo(265.33, 1);
  });
  test('never collapses below 48', () => {
    expect(
      padWordmarkFontSize({
        coverWidth: 800,
        measuredWidth: 300,
        paneHeight: 300,
        reservedHeight: 400,
      })
    ).toBe(48);
  });
});
