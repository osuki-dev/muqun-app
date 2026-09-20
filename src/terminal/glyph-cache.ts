/**
 * What the renderer remembers about a glyph, and the identity that decides
 * whether the memory is still about the right font.
 *
 * Lifted out of `skia-terminal.tsx` when the monospace slot made the cache's
 * founding assumption false. It is pure -- a `WeakMap`, a `Map` and arithmetic,
 * with the font reduced to the two methods that are actually called -- so the
 * rule below can be stated in a test rather than only in a comment, which is
 * what it needed: the bug it now prevents is invisible on every device where
 * nobody has changed their font.
 */

/**
 * The part of an `SkFont` this file uses.
 *
 * Structural rather than the Skia type, and for one reason: a test can hand in
 * two fonts whose glyph tables disagree, which is the whole of what has to be
 * proved here and is not something a real `SkFont` can be asked for in a bare
 * process.
 */
export interface GlyphSource {
  getGlyphIDs(text: string): number[];
  getGlyphWidths(ids: number[]): number[];
}

/**
 * Stable ids for values whose identity, not their contents, decides whether a
 * recorded block is still valid: the palette (a fresh object per theme change)
 * and the loaded font. Comparing a whole palette on every refresh costs more
 * than tagging the object once.
 */
const renderingIdentities = new WeakMap<object, number>();
let nextRenderingIdentity = 1;

export function renderingIdentity(value: object | null | undefined): number {
  if (!value) return 0;
  let identity = renderingIdentities.get(value);
  if (identity === undefined) {
    identity = nextRenderingIdentity;
    nextRenderingIdentity += 1;
    renderingIdentities.set(value, identity);
  }
  return identity;
}

/**
 * Glyph id and advance for one grapheme, cached for the lifetime of the process.
 *
 * `getGlyphIDs` and `getGlyphWidths` are JSI host calls: each one crosses into
 * C++ and marshals an array both ways. Called per visible cell per repaint they
 * dominate the renderer -- a 240-line pane is tens of thousands of crossings
 * every refresh, which is most of what makes the phone warm. A terminal draws
 * from a small alphabet, so after the first frame this is a map hit.
 *
 * Keyed by the **typeface** as well as by size and grapheme, and that is a
 * correctness key rather than a performance one.
 *
 * It used to be keyed by size and grapheme alone, on the stated grounds that
 * "the typeface never changes: one font ships with the app". That stopped being
 * true the moment a reader could put their own face in the monospace slot, and
 * what this stores is a **glyph id** -- an index into one specific font's glyph
 * table, meaningless in any other. Glyph 57 is one character in JetBrains Mono
 * and whatever happens to be 57th in the reader's face. So a cache hit across a
 * swap does not draw the old font: it draws the *new* font's glyph at the *old*
 * font's index, which is a screen of plausible-looking wrong characters, and
 * `drawGlyphs` takes an id and cannot notice.
 *
 * The advance stored here is the linear one, because the font handed in has
 * linear metrics on from the moment it is loaded. It has to match the rule
 * `measureCellWidth` used: the renderer's centring term is the difference
 * between the cell and the advance, so measuring the two under different
 * rounding would turn a term that should be a fixed sub-pixel nudge into a
 * per-glyph shift.
 */
const glyphCache = new Map<string, { id: number; advance: number }>();

/**
 * How many glyph entries are kept before the map is emptied.
 *
 * The cap is what keeps the added dimension from being a leak. Identities are
 * monotonic, so a swap does not replace the old font's entries -- it adds a
 * generation beside them -- and a reader trying several faces would otherwise
 * accumulate every generation for the life of the process.
 *
 * Cleared wholesale rather than evicted per entry, because the map is rebuilt
 * from a small alphabet within a frame or two of drawing; and cleared on size
 * rather than on a change of identity, because clearing whenever the font
 * object changed would thrash -- two panes at the same size hold two different
 * `SkFont` objects for the same face and would take turns emptying it.
 *
 * 4096 is generous against what a terminal draws: Latin, box drawing and the
 * Nerd Font ranges are a few hundred graphemes per font and size.
 */
export const GLYPH_CACHE_LIMIT = 4096;

/** The key a glyph's metrics are stored under. */
export function glyphCacheKey(fontId: number, fontSize: number, grapheme: string): string {
  return `${fontId}|${fontSize}|${grapheme}`;
}

export function glyphMetrics(
  grapheme: string,
  fontSize: number,
  font: GlyphSource | null,
  cellWidth: number
): { id: number; advance: number } {
  const key = glyphCacheKey(renderingIdentity(font), fontSize, grapheme);
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const id = font?.getGlyphIDs(grapheme)[0] ?? 0;
  const advance = id === 0 ? cellWidth : (font?.getGlyphWidths([id])[0] ?? cellWidth);
  const metrics = { id, advance };
  if (glyphCache.size >= GLYPH_CACHE_LIMIT) glyphCache.clear();
  glyphCache.set(key, metrics);
  return metrics;
}

/** How many entries are held. For the test that proves the cap is a cap. */
export function glyphCacheSize(): number {
  return glyphCache.size;
}

/** Empties the cache. For tests; nothing in the app needs to call this. */
export function resetGlyphCache(): void {
  glyphCache.clear();
}
