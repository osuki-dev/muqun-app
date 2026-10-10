import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import {
  PAD_COVER_TITLE_LINE_HEIGHT,
  padCardColumns,
  padCover,
  padCoverKind,
  padHomeColumns,
  padLaunchLayoutEnabled,
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

describe('padHomeColumns and padCardColumns', () => {
  // inner width (1280dp landscape, 800dp portrait), cards -> work/recent widths, card columns
  test.each<[number, number, 1 | 2]>([
    [Math.min(1280, EDITORIAL_PAD_MAX_WIDTH), 1, 1],
    [Math.min(1280, EDITORIAL_PAD_MAX_WIDTH), 2, 2],
    [Math.min(1280, EDITORIAL_PAD_MAX_WIDTH), 4, 2],
    [800, 2, 1],
  ])('content %p with %p cards', (content, cards, columns) => {
    const inner = getEditorialLayoutGeometry(content).innerWidth;
    const { work, recent } = padHomeColumns(inner);
    expect(work + recent + 24).toBe(inner);
    expect(padCardColumns(work, cards)).toBe(columns);
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

describe('padCover', () => {
  // screen height (dp), viewport left after the status bar and page inset, title width at 100pt
  test.each<[string, number, number, number]>([
    ['landscape, pack title', 800, 752, 420],
    ['landscape, before the title is measured', 800, 752, 0],
    ['portrait, long pack title', 1280, 1208, 900],
  ])('%s', (_name, screen, viewport, measuredTitleWidth) => {
    const inner = getEditorialLayoutGeometry(screen === 800 ? 1280 : 800).innerWidth;
    const coverWidth = padHomeColumns(inner).work;
    const block = padCover({
      viewportHeight: viewport,
      coverWidth,
      measuredTitleWidth,
      wordmark: false,
    });
    // A fixed 40-45% of the screen, whatever the title.
    expect(block.height / screen).toBeGreaterThanOrEqual(0.4);
    expect(block.height / screen).toBeLessThanOrEqual(0.45);
    // The painting stays inside the block, clear of the title's start.
    expect(block.artwork.height).toBeLessThanOrEqual(block.height);
    expect(block.artwork.width).toBeLessThanOrEqual(coverWidth * 0.85 + 1);
    // The title fits the column and leaves the painting most of the block.
    if (measuredTitleWidth > 0)
      expect((block.titleSize * measuredTitleWidth) / 100).toBeLessThanOrEqual(coverWidth);
    expect(block.titleSize * PAD_COVER_TITLE_LINE_HEIGHT).toBeLessThanOrEqual(block.height * 0.4);
  });
});
