// The renderer's glyph memory, and the one thing it has to get right when the
// reader changes their monospace font.
//
// This cache used to be keyed by size and grapheme alone, with a comment
// explaining that "the typeface never changes: one font ships with the app".
// What it stores is a glyph *id* -- an index into one specific font's glyph
// table -- and `drawGlyphs` takes an id and cannot notice that it came from a
// different font. So a hit across a swap does not draw the old face; it draws
// the new face's glyph at the old face's index, which is a terminal full of
// plausible-looking wrong characters.
//
// It is invisible on every device where nobody has changed their font, which is
// why it is pinned here rather than left to review.
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  GLYPH_CACHE_LIMIT,
  glyphCacheKey,
  glyphCacheSize,
  glyphMetrics,
  renderingIdentity,
  resetGlyphCache,
  type GlyphSource,
} from '@/terminal/glyph-cache';

/**
 * A font whose glyph table is whatever the test says it is, and which counts
 * how often it was asked.
 *
 * The count is half the point: the cache exists because `getGlyphIDs` and
 * `getGlyphWidths` are JSI host calls, so a test that proved correctness by
 * making it miss every time would have deleted the feature.
 */
function fakeFont(table: Record<string, { id: number; advance: number }>): GlyphSource & {
  calls: number;
} {
  const font = {
    calls: 0,
    getGlyphIDs(text: string) {
      font.calls += 1;
      return [table[text]?.id ?? 0];
    },
    getGlyphWidths(ids: number[]) {
      const entry = Object.values(table).find((glyph) => glyph.id === ids[0]);
      return [entry?.advance ?? 0];
    },
  };
  return font;
}

const CELL = 7.8;

beforeEach(() => resetGlyphCache());

describe('renderingIdentity', () => {
  test('tags an object once and answers the same number after', () => {
    const font = fakeFont({});
    const first = renderingIdentity(font);
    expect(renderingIdentity(font)).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  test('two objects are two identities, and nothing is zero', () => {
    expect(renderingIdentity(fakeFont({}))).not.toBe(renderingIdentity(fakeFont({})));
    // Zero is reserved for "no font", so it can never collide with a real one.
    expect(renderingIdentity(null)).toBe(0);
    expect(renderingIdentity(undefined)).toBe(0);
  });
});

describe('glyphMetrics', () => {
  test('asks the font once and answers from memory after', () => {
    const font = fakeFont({ A: { id: 57, advance: 7.2 } });
    expect(glyphMetrics('A', 13, font, CELL)).toEqual({ id: 57, advance: 7.2 });
    expect(glyphMetrics('A', 13, font, CELL)).toEqual({ id: 57, advance: 7.2 });
    expect(glyphMetrics('A', 13, font, CELL)).toEqual({ id: 57, advance: 7.2 });
    expect(font.calls).toBe(1);
  });

  test('a size is still part of the key: the advance is in points', () => {
    const font = fakeFont({ A: { id: 57, advance: 7.2 } });
    glyphMetrics('A', 13, font, CELL);
    glyphMetrics('A', 16, font, CELL);
    expect(font.calls).toBe(2);
  });

  test('a glyph the font does not have falls back to the cell width', () => {
    // Which is what sends the grapheme down the shaped-fallback path instead.
    const font = fakeFont({});
    expect(glyphMetrics('漢', 13, font, CELL)).toEqual({ id: 0, advance: CELL });
  });

  test("THE BUG: a second font is never served the first font's glyph id", () => {
    // The same character at the same size in two faces whose tables disagree,
    // which is exactly what installing a font does. Before the typeface joined
    // the key, the second call was a hit and returned 57 -- an index into
    // JetBrains Mono's table, used to draw with the reader's font.
    const bundled = fakeFont({ A: { id: 57, advance: 7.2 } });
    const reader = fakeFont({ A: { id: 4, advance: 6.5 } });

    expect(glyphMetrics('A', 13, bundled, CELL)).toEqual({ id: 57, advance: 7.2 });
    expect(glyphMetrics('A', 13, reader, CELL)).toEqual({ id: 4, advance: 6.5 });

    // And back again: the first font's entry was not evicted by the second, so
    // a reader switching between two faces pays the JSI calls once each.
    expect(glyphMetrics('A', 13, bundled, CELL)).toEqual({ id: 57, advance: 7.2 });
    expect(bundled.calls).toBe(1);
    expect(reader.calls).toBe(1);
  });

  test('the advance travels with the id, so the cell centring stays right', () => {
    // The renderer's centring term is `cell - advance`. A stale advance is a
    // per-glyph horizontal shift rather than a wrong character, which is the
    // quieter half of the same bug.
    const wide = fakeFont({ M: { id: 1, advance: 13 } });
    const narrow = fakeFont({ M: { id: 1, advance: 6.5 } });
    expect(glyphMetrics('M', 13, wide, CELL).advance).toBe(13);
    expect(glyphMetrics('M', 13, narrow, CELL).advance).toBe(6.5);
  });

  test('the key spells out all three parts, in one place', () => {
    const font = fakeFont({ A: { id: 57, advance: 7.2 } });
    expect(glyphCacheKey(renderingIdentity(font), 13, 'A')).toBe(`${renderingIdentity(font)}|13|A`);
    // A separator that cannot be produced by a font id or a size, so a
    // grapheme that happens to be a digit cannot forge a neighbouring field.
    expect(glyphCacheKey(1, 13, '|')).toBe('1|13||');
  });
});

describe('the cap', () => {
  test('a cache that fills up is emptied rather than left to grow', () => {
    // Identities are monotonic, so a swap adds a generation beside the old
    // one rather than replacing it. Without a cap, a reader trying six fonts
    // would hold six generations for the life of the process.
    const font = fakeFont({});
    for (let index = 0; index <= GLYPH_CACHE_LIMIT; index += 1) {
      glyphMetrics(`g${index}`, 13, font, CELL);
    }
    expect(glyphCacheSize()).toBeLessThanOrEqual(GLYPH_CACHE_LIMIT);
    expect(glyphCacheSize()).toBeGreaterThan(0);
  });

  test('the cap is generous against what a terminal actually draws', () => {
    // Latin, box drawing and the Nerd Font ranges are a few hundred graphemes
    // per font and size, so a clear is rare rather than a per-frame event.
    expect(GLYPH_CACHE_LIMIT).toBeGreaterThanOrEqual(2048);
  });
});
