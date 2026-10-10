import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import {
  PAD_COVER_TITLE_LINE_HEIGHT,
  PAD_WORDMARK_DESCENDER,
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
  // content width and screen height (dp), viewport left after the status bar
  // and page inset, title width at 100pt, wordmark cover, work in the column
  // -> the block's share of the screen
  test.each<[string, number, number, number, number, boolean, boolean, [number, number]]>([
    ['landscape pack, tiles only', 1280, 800, 752, 420, false, false, [0.4, 0.45]],
    ['landscape pack, cards under it', 1280, 800, 752, 420, false, true, [0.2, 0.22]],
    ['landscape wordmark, cards under it', 1280, 800, 752, 330, true, true, [0.2, 0.22]],
    ['portrait pack, long title', 800, 1280, 1208, 900, false, false, [0.4, 0.45]],
  ])(
    '%s',
    (_name, content, screen, viewport, measuredTitleWidth, wordmark, compact, [low, high]) => {
      const coverWidth = padHomeColumns(getEditorialLayoutGeometry(content).innerWidth).work;
      const cover = { viewportHeight: viewport, coverWidth, measuredTitleWidth, wordmark };
      const block = padCover({ ...cover, compact });
      // A fixed share of the screen, whatever the title.
      expect(block.height / screen).toBeGreaterThanOrEqual(low);
      expect(block.height / screen).toBeLessThanOrEqual(high);
      // The painting stays inside the block, clear of the title's start; work
      // under it crops the painting rather than shrinking it.
      expect(block.artwork.height).toBeLessThanOrEqual(block.height);
      expect(block.artwork.width).toBeLessThanOrEqual(coverWidth * 0.85 + 1);
      if (compact)
        expect(block.artwork.width).toBe(padCover({ ...cover, compact: false }).artwork.width);
      // The title fits the column; over a painting it leaves it most of the
      // block, and the wordmark's descender stays inside the block.
      expect((block.titleSize * measuredTitleWidth) / 100).toBeLessThanOrEqual(coverWidth);
      if (wordmark)
        expect(
          block.titleSize * (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER)
        ).toBeLessThanOrEqual(block.height);
      else
        expect(block.titleSize * PAD_COVER_TITLE_LINE_HEIGHT).toBeLessThanOrEqual(
          block.height * 0.4
        );
    }
  );
});
