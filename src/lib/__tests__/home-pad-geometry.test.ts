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
  // content width (dp), viewport left after the status bar and page inset,
  // title width at 100pt, wordmark cover
  test.each<[string, number, number, number, boolean]>([
    ['landscape pack', 1280, 752, 420, false],
    ['landscape wordmark', 1280, 752, 330, true],
    ['portrait pack, long title', 800, 1208, 900, false],
  ])('%s', (_name, content, viewport, measuredTitleWidth, wordmark) => {
    const coverWidth = padHomeColumns(getEditorialLayoutGeometry(content).innerWidth).cover;
    const block = padCover({ viewportHeight: viewport, coverWidth, measuredTitleWidth, wordmark });
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
  ])('%s', (_name, inset, [width, height], keyboardVisible, fieldFocused, expected) => {
    expect(
      nextRestingInset(resting, { inset, width, height, keyboardVisible, fieldFocused }).inset
    ).toBe(expected);
  });
});

describe('Pad artwork and title depth', () => {
  const landscape = { viewportHeight: 752, coverWidth: 664, wordmark: false };

  test('a scenic rectangle cannot cover any part of the title', () => {
    const scene = padCover({ ...landscape, measuredTitleWidth: 620, foreground: false });
    expect(scene.titleZIndex).toBeGreaterThan(1);
    // Retain the picture's full existing drawing band; no new crop or scaling.
    expect(scene.artwork.height).toBe(scene.height);
  });

  test('long portrait titles keep most of every letter clear while retaining foreground depth', () => {
    for (const measuredTitleWidth of [600, 900, 1200]) {
      const portrait = padCover({ ...landscape, measuredTitleWidth, foreground: true });
      const lineHeight = portrait.titleSize * PAD_COVER_TITLE_LINE_HEIGHT;
      const artworkTop = portrait.height - portrait.artwork.height;
      expect(portrait.titleZIndex).toBeLessThan(1);
      expect(artworkTop).toBeGreaterThanOrEqual(lineHeight * 0.75);
      expect(artworkTop).toBeLessThan(lineHeight);
    }
  });

  test('a short title beside a portrait keeps its existing size and position', () => {
    const portrait = padCover({ ...landscape, measuredTitleWidth: 300, foreground: true });
    expect(portrait.artwork.height).toBe(portrait.height);
    expect(portrait.artwork.width).toBe(Math.round(portrait.height / 0.9));
    expect(portrait.titleZIndex).toBe(0);
  });

  test('an unmeasured title starts safe, but a cover with no title needs no clearance', () => {
    const first = padCover({ ...landscape, measuredTitleWidth: 0, foreground: true });
    const untitled = padCover({
      ...landscape,
      measuredTitleWidth: 0,
      foreground: true,
      hasTitle: false,
    });
    expect(first.artwork.height).toBeLessThan(first.height);
    expect(untitled.artwork.height).toBe(untitled.height);
  });
});
