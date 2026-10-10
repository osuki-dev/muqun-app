import { describe, expect, test } from 'bun:test';
import { EDITORIAL_PAD_MAX_WIDTH, getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import {
  PAD_COVER_TITLE_LINE_HEIGHT,
  PAD_WORDMARK_DESCENDER,
  padCardColumns,
  padCover,
  padCoverKind,
  padHomeColumns,
  nextRestingInset,
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
  // inner width (1280dp landscape, 800dp portrait), cards -> cover/work widths, card columns
  test.each<[number, number, 1 | 2]>([[Math.min(1280, EDITORIAL_PAD_MAX_WIDTH), 2, 1]])(
    'content %p with %p cards',
    (content, cards, columns) => {
      const inner = getEditorialLayoutGeometry(content).innerWidth;
      const { cover, work } = padHomeColumns(inner);
      expect(cover + work + 24).toBe(inner);
      expect(padCardColumns(work, cards)).toBe(columns);
    }
  );
  test('a column with room for two cards sets them two abreast', () => {
    expect(padCardColumns(700, 2)).toBe(2);
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
  // and page inset, title width at 100pt, wordmark cover -> the block's share
  // of the screen
  test.each<[string, number, number, number, number, boolean, [number, number]]>([
    ['landscape pack', 1280, 800, 752, 420, false, [0.4, 0.45]],
    ['landscape wordmark', 1280, 800, 752, 330, true, [0.4, 0.45]],
    ['portrait pack, long title', 800, 1280, 1208, 900, false, [0.4, 0.45]],
  ])('%s', (_name, content, screen, viewport, measuredTitleWidth, wordmark, [low, high]) => {
    const coverWidth = padHomeColumns(getEditorialLayoutGeometry(content).innerWidth).cover;
    const block = padCover({ viewportHeight: viewport, coverWidth, measuredTitleWidth, wordmark });
    // A fixed share of the screen, whatever the title.
    expect(block.height / screen).toBeGreaterThanOrEqual(low);
    expect(block.height / screen).toBeLessThanOrEqual(high);
    // The painting stays inside the block, clear of the title's start.
    expect(block.artwork.height).toBeLessThanOrEqual(block.height);
    expect(block.artwork.width).toBeLessThanOrEqual(coverWidth * 0.85 + 1);
    // The title fits the column; over a painting it leaves it most of the
    // block, and the wordmark's descender stays inside the block.
    expect((block.titleSize * measuredTitleWidth) / 100).toBeLessThanOrEqual(coverWidth);
    if (wordmark)
      expect(
        block.titleSize * (PAD_COVER_TITLE_LINE_HEIGHT + PAD_WORDMARK_DESCENDER)
      ).toBeLessThanOrEqual(block.height);
    else
      expect(block.titleSize * PAD_COVER_TITLE_LINE_HEIGHT).toBeLessThanOrEqual(block.height * 0.4);
  });
});

describe('nextRestingInset: the Pad page is sized from a no-keyboard inset only', () => {
  const resting = { inset: 0, width: 1280, height: 800 };
  // name, the inset now, window size, soft keyboard up, a field focused -> inset kept
  test.each<[string, number, [number, number], boolean, boolean, number]>([
    ['a keyboard showing never records its inset', 32, [1280, 800], true, true, 0],
    [
      'a focused field (the dock, Recent search, a sheet) does not either',
      32,
      [1280, 800],
      false,
      true,
      0,
    ],
    [
      'rotated with a field still focused, no keyboard: the new inset',
      48,
      [800, 1280],
      false,
      true,
      48,
    ],
    ['rotated while the keyboard shows: wait for it to hide', 48, [800, 1280], true, false, 0],
    ['nothing focused, no keyboard: the inset as measured', 24, [1280, 800], false, false, 24],
  ])('%s', (_name, inset, [width, height], keyboardVisible, fieldFocused, expected) => {
    expect(
      nextRestingInset(resting, { inset, width, height, keyboardVisible, fieldFocused }).inset
    ).toBe(expected);
  });
});
