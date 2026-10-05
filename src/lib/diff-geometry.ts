/**
 * The arithmetic behind a diff's columns: how many character cells a line
 * takes on screen, and how wide the gutter has to be for the numbers it holds.
 *
 * Pure so it can be tested without React Native. See the note at the top of
 * `diff-rows.tsx` for how the viewer uses it.
 */

/** How many cells a tab is counted as. */
export const TAB_CELLS = 4;

/** The fewest digits a number column is sized for. */
export const MIN_GUTTER_DIGITS = 2;

/**
 * Whether a code point is drawn two cells wide.
 *
 * A monospace face has no CJK or emoji glyphs of its own; the fallback face
 * that draws them is roughly twice the Latin advance. Counting them as one cell
 * would lay the panning content out too narrow, and the longest line would end
 * in an ellipsis. Over-counting is the safe direction: a little slack on the
 * right.
 */
export function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/**
 * How many character cells `text` takes on one line: a tab counts as
 * `TAB_CELLS`, a wide glyph as two, anything else as one. A code point is one
 * glyph, so a surrogate pair is counted once.
 */
export function cellsOf(text: string): number {
  // The common case, without a walk: plain ASCII.
  if (!/[^\x20-\x7e]/.test(text)) return text.length;
  let cells = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    cells += code === 9 ? TAB_CELLS : isWideCodePoint(code) ? 2 : 1;
  }
  return cells;
}

/** The line numbers a list holds: how many digits the widest needs, and which sides appear. */
export interface GutterNumbers {
  digits: number;
  /** 2 when the list carries both old and new numbers; 1 for a one-sided list. */
  numberColumns: 1 | 2;
}

/** A row with line numbers, in the shape the diff rows have. */
interface NumberedRow {
  type: string;
  oldLine?: number | null;
  newLine?: number | null;
}

/**
 * The gutter's needs, read off the rows.
 *
 * Two number columns as soon as both sides appear anywhere in the list, not only
 * when one row has both: a hunk of pure removals and additions has no row with
 * two numbers, and folding its old and new numbers into one column would print
 * two different numberings down the same edge. An untracked or deleted file has
 * one side only and gets one column.
 */
export function gutterNumbersOf(rows: Iterable<NumberedRow>): GutterNumbers {
  let largest = 0;
  let hasOld = false;
  let hasNew = false;
  for (const row of rows) {
    if (row.type !== 'line') continue;
    if (row.oldLine != null) {
      hasOld = true;
      if (row.oldLine > largest) largest = row.oldLine;
    }
    if (row.newLine != null) {
      hasNew = true;
      if (row.newLine > largest) largest = row.newLine;
    }
  }
  return {
    digits: Math.max(MIN_GUTTER_DIGITS, String(Math.max(0, Math.trunc(largest))).length),
    numberColumns: hasOld && hasNew ? 2 : 1,
  };
}

/**
 * The gutter's width: the number columns, the marker, the leading inset and the
 * gap after each number. Rounded up to a whole point so a column is never a
 * fraction short of its digits.
 */
export function gutterWidthOf({
  digits,
  numberColumns,
  numberAdvance,
  markerWidth,
  inset,
  gap,
}: GutterNumbers & {
  /** One digit's advance in the gutter's own number style. */
  numberAdvance: number;
  markerWidth: number;
  /** The gutter's leading padding. */
  inset: number;
  /** The gap between the gutter's columns. */
  gap: number;
}): { width: number; numberWidth: number } {
  const numberWidth = Math.ceil(digits * numberAdvance);
  return {
    numberWidth,
    width: numberColumns * (numberWidth + gap) + markerWidth + inset,
  };
}
