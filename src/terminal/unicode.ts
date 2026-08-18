const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) return Array.from(value);
  return Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
}

export function graphemeWidth(value: string): 0 | 1 | 2 {
  let hasVisibleCodePoint = false;
  for (const character of value) {
    const width = codePointWidth(character.codePointAt(0) ?? 0);
    if (width === 0) continue;
    hasVisibleCodePoint = true;
    if (width === 2) return 2;
  }
  return hasVisibleCodePoint ? 1 : 0;
}

/**
 * Width of a single code point standing on its own -- the per-code-point core
 * of `graphemeWidth`, exported so the snapshot fast path can measure a line of
 * standalone code units without segmenting it.
 */
export function codePointWidth(codePoint: number): 0 | 1 | 2 {
  if (isZeroWidthCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) || isEmojiCodePoint(codePoint) ? 2 : 1;
}

/**
 * True for BMP code units that a grapheme segmenter never joins to a
 * neighbour: none of them is a combining mark, a joiner, a variation selector,
 * a regional indicator or a conjoining jamo, and none is a surrogate. A line
 * built only from these therefore has exactly one grapheme per code unit, so
 * `displayWidth(line)` equals the sum of `codePointWidth` over its units and no
 * segmentation is needed to lay it out.
 *
 * The list is deliberately a whitelist: anything unlisted (emoji surrogate
 * pairs, ZWJ sequences, variation selectors, combining marks, Indic conjuncts,
 * Hangul jamo) sends the caller back to real segmentation, so being
 * conservative costs speed, never correctness. The ranges cover what terminal
 * output actually contains -- Latin/Greek/Cyrillic, punctuation, box drawing,
 * block and geometric shapes, arrows, dingbats, CJK and fullwidth forms.
 *
 * `__tests__/flat-fast-path.test.ts` segments the whole whitelist as one string
 * and asserts it yields one cluster per unit, so a wrong range fails there
 * rather than silently mis-measuring a pane.
 */
export function isStandaloneCodeUnit(unit: number): boolean {
  if (unit < 0x80) return unit >= 0x20 && unit !== 0x7f;
  return (
    (unit >= 0x00a0 && unit <= 0x02ff) || // Latin-1 .. spacing modifiers (0x300+ combines)
    (unit >= 0x0370 && unit <= 0x0482) || // Greek, Cyrillic (0x483..0x489 combine)
    (unit >= 0x048a && unit <= 0x052f) ||
    (unit >= 0x2000 && unit <= 0x200a) || // spaces (0x200b..0x200f are zero-width/bidi)
    (unit >= 0x2010 && unit <= 0x2027) || // punctuation (0x2028/0x2029 are separators)
    (unit >= 0x2030 && unit <= 0x205e) || // punctuation (0x2060+ are invisible operators)
    (unit >= 0x20a0 && unit <= 0x20bf) || // currency (0x20d0+ combine)
    (unit >= 0x2100 && unit <= 0x2426) || // letterlike, arrows, maths, technical
    (unit >= 0x2440 && unit <= 0x2bff) || // box drawing, blocks, shapes, dingbats
    (unit >= 0x2e80 && unit <= 0x2fef) || // CJK radicals, Kangxi
    (unit >= 0x3000 && unit <= 0x3029) || // CJK punctuation (0x302a..0x302f combine)
    (unit >= 0x3030 && unit <= 0x3098) || // kana (0x3099/0x309a combine)
    (unit >= 0x309b && unit <= 0xa4cf) || // kana, bopomofo, CJK ideographs, Yi
    (unit >= 0xac00 && unit <= 0xd7a3) || // precomposed Hangul syllables
    (unit >= 0xf900 && unit <= 0xfaff) || // CJK compatibility ideographs
    (unit >= 0xfe10 && unit <= 0xfe19) || // vertical forms (0xfe20+ combine)
    (unit >= 0xfe30 && unit <= 0xfe6f) || // CJK compatibility forms
    (unit >= 0xff01 && unit <= 0xff60) || // fullwidth forms
    (unit >= 0xffe0 && unit <= 0xffe6)
  );
}

export function displayWidth(value: string): number {
  return splitGraphemes(value).reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x0483 && codePoint <= 0x0489) ||
    (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
    codePoint === 0x05bf ||
    (codePoint >= 0x05c1 && codePoint <= 0x05c2) ||
    (codePoint >= 0x0610 && codePoint <= 0x061a) ||
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    codePoint === 0x0670 ||
    (codePoint >= 0x06d6 && codePoint <= 0x06ed) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

/**
 * Two columns because the glyph is drawn as an emoji.
 *
 * The supplementary planes are taken wholesale: essentially everything an agent
 * emits from there has emoji presentation by default.
 *
 * U+2600..U+27BF cannot be. That block is mostly *dingbats* -- Emoji=Yes but
 * Emoji_Presentation=No, which means the default rendering is text, one column,
 * and that is what every terminal and every wcwidth gives them. Claiming the
 * whole block was two columns mis-measured the characters agents use most:
 * `✓` U+2713, `✳` U+2733, `✗` U+2717, `❯` U+276F. A pane is laid out by the
 * gateway before we see it, so a character we score one column wider than the
 * gateway did shifts every cell after it on that row -- the row disagrees with
 * the grid it was written for, and in a CJK/Latin row the disagreement lands
 * mid-word. Note `✔` U+2714 and `✻` U+273B are in `MISSING_GLYPH_SUBSTITUTES`
 * below, and their substitutes `✓` and `✳` are in this same block, so the
 * substitution stays width-preserving under either rule.
 *
 * Listed instead is the Emoji_Presentation=Yes subset of the block -- the ones
 * that really do render as colour emoji and really are two columns.
 */
function isEmojiCodePoint(codePoint: number): boolean {
  // Ordered for the case that actually runs: `codePointWidth` calls this for
  // every code point on every row, and almost all of them are ASCII. One
  // comparison rejects those, before any of the list below is reached.
  if (codePoint < 0x2600) return false;
  if (codePoint > 0x27bf) return codePoint >= 0x1f000 && codePoint <= 0x1faff;
  return (
    (codePoint >= 0x2614 && codePoint <= 0x2615) ||
    (codePoint >= 0x2648 && codePoint <= 0x2653) ||
    codePoint === 0x267f ||
    codePoint === 0x2693 ||
    codePoint === 0x26a1 ||
    (codePoint >= 0x26aa && codePoint <= 0x26ab) ||
    (codePoint >= 0x26bd && codePoint <= 0x26be) ||
    (codePoint >= 0x26c4 && codePoint <= 0x26c5) ||
    codePoint === 0x26ce ||
    codePoint === 0x26d4 ||
    codePoint === 0x26ea ||
    (codePoint >= 0x26f2 && codePoint <= 0x26f3) ||
    codePoint === 0x26f5 ||
    codePoint === 0x26fa ||
    codePoint === 0x26fd ||
    codePoint === 0x2705 ||
    (codePoint >= 0x270a && codePoint <= 0x270b) ||
    codePoint === 0x2728 ||
    codePoint === 0x274c ||
    codePoint === 0x274e ||
    (codePoint >= 0x2753 && codePoint <= 0x2755) ||
    codePoint === 0x2757 ||
    (codePoint >= 0x2795 && codePoint <= 0x2797) ||
    codePoint === 0x27b0 ||
    codePoint === 0x27bf
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

/**
 * Characters the agents draw that the bundled JetBrains Mono Nerd Font has no
 * glyph for. Checked against the shipped font's cmap, not assumed: U+23F5,
 * U+23FA, U+23BF, U+273B, U+203B, U+25FB and U+2714 are all absent, so each one
 * falls back to whatever the system picks -- a differently-sized glyph that
 * breaks the column grid, which is what shows up as a stray icon.
 *
 * Each substitute is the closest shape that IS in the font and is the same
 * display width, so the grid holds and the line still reads the way the agent
 * drew it.
 */
const MISSING_GLYPH_SUBSTITUTES: Record<string, string> = {
  '\u23F5': '\u25B6', // ⏵ play  -> ▶
  '\u23FA': '\u25CF', // ⏺ record -> ●
  '\u23BF': '\u2514', // ⎿ corner -> └
  '\u273B': '\u2733', // ✻ asterisk -> ✳
  '\u203B': '\u002A', // ※ reference -> *
  '\u25FB': '\u25A1', // ◻ square -> □
  '\u2714': '\u2713', // ✔ heavy check -> ✓
};

/** True when the pane contains anything the bundled font cannot draw. */
export function hasMissingGlyphs(value: string): boolean {
  for (const character of Object.keys(MISSING_GLYPH_SUBSTITUTES)) {
    if (value.includes(character)) return true;
  }
  return false;
}

/**
 * Swaps in glyphs the bundled font can actually draw, across a whole string.
 *
 * Kept for callers that have a snapshot rather than a grid. The Skia terminal
 * deliberately does not use it any more -- see `substituteRenderedGrapheme`.
 */
export function substituteMissingGlyphs(value: string): string {
  if (!hasMissingGlyphs(value)) return value;
  let result = value;
  for (const [missing, substitute] of Object.entries(MISSING_GLYPH_SUBSTITUTES)) {
    result = result.split(missing).join(substitute);
  }
  return result;
}

/**
 * The glyph to *draw* for one grapheme: the same substitution, made one cell at
 * a time as the row is recorded rather than to the whole snapshot before it is
 * parsed.
 *
 * Which matters because the parsed frame is no longer only what the pane draws
 * -- it is also what the pane copies. Substituting ahead of the parse wrote the
 * renderer's choice of glyph into the model, so a `✔` the agent printed came
 * back off the clipboard as `✓`, a character the session never contained.
 * Substituting here leaves `cells[].text` holding exactly what was printed, and
 * the reader pastes their own text.
 *
 * Layout is unaffected, and provably so: every substitute has the same display
 * width as the character it replaces -- asserted over the whole table in
 * `__tests__/unicode.test.ts` -- so each one lands in the cell it always did.
 */
export function substituteRenderedGrapheme(grapheme: string): string {
  return MISSING_GLYPH_SUBSTITUTES[grapheme] ?? grapheme;
}
