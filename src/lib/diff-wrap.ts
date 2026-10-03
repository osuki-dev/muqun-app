/**
 * The arithmetic behind a wrapped diff: how many character cells fit beside
 * the gutter, how many visual lines a code line takes at that width, the text
 * that draws exactly those lines, and how wide the gutter has to be for the
 * numbers it holds.
 *
 * Pure so it can be tested without React Native, and so the list's row heights
 * and the rows' drawn text come from one function and cannot disagree. See the
 * note at the top of `diff-rows.tsx` for why heights are computed at all.
 */

/** How many cells a tab takes. Tabs are drawn as this many spaces. */
export const TAB_CELLS = 4;

/** The narrowest code column the arithmetic will produce, however small the viewport. */
export const MIN_COLUMNS = 8;

/** The fewest digits a number column is sized for. */
export const MIN_GUTTER_DIGITS = 2;

const TAB_SPACES = ' '.repeat(TAB_CELLS);

/**
 * Whether a code point is drawn two cells wide.
 *
 * A monospace face has no CJK or emoji glyphs of its own; the fallback face
 * that draws them is roughly twice the Latin advance. Counting them as one cell
 * would put twice as much ink on a line as the arithmetic allows for, and the
 * line would wrap a second time inside a row whose height was already decided.
 * Over-counting is the safe direction: a line breaks a little early.
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

function cellsOfCodePoint(code: number): number {
  if (code === 9) return TAB_CELLS;
  return isWideCodePoint(code) ? 2 : 1;
}

/**
 * Lays one line out in `columns` cells and returns how many visual lines it
 * takes, pushing each line's text onto `chunks` when asked for it.
 *
 * Breaks at the cell, not at a space: a diff line is code, and a word-wrapping
 * break would both move the break point and need a measurement to know where it
 * went. A code point is never split, so a surrogate pair stays whole.
 */
function layOut(text: string, columns: number, chunks?: string[]): number {
  const width = Math.max(1, Math.floor(columns));
  let lines = 1;
  let used = 0;
  let current = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const cells = cellsOfCodePoint(code);
    if (used > 0 && used + cells > width) {
      if (chunks) chunks.push(current);
      current = '';
      used = 0;
      lines += 1;
    }
    used += cells;
    if (chunks) current += code === 9 ? TAB_SPACES : char;
  }
  if (chunks) chunks.push(current);
  return lines;
}

/** How many visual lines `text` takes in a code column `columns` cells wide. */
export function visualLines(text: string, columns: number): number {
  // The common case, without a walk: short plain ASCII.
  if (text.length <= columns && !/[^\x20-\x7e]/.test(text)) return 1;
  return layOut(text, columns);
}

/**
 * The text that draws `text` as exactly `visualLines(text, columns)` lines: tabs
 * expanded to spaces, and a newline at every break.
 *
 * Each chunk fits its column by construction, so the platform's own wrapping
 * never has anything left to do -- its word-wrapping breaks earlier, at spaces,
 * and would disagree with the computed height.
 */
export function wrapForColumns(text: string, columns: number): string {
  const chunks: string[] = [];
  layOut(text, columns, chunks);
  return chunks.join('\n');
}

/**
 * How many cells of code fit on a line.
 *
 * One cell of slack: the advance is measured rather than exact, and a column a
 * hair narrower than the arithmetic assumes would wrap a full line a second
 * time inside a row sized for one.
 */
export function codeColumns({
  viewportWidth,
  gutterWidth,
  padding,
  advance,
}: {
  viewportWidth: number;
  gutterWidth: number;
  /** The code's own inset, on each side. */
  padding: number;
  advance: number;
}): number {
  if (!(advance > 0)) return MIN_COLUMNS;
  return Math.max(
    MIN_COLUMNS,
    Math.floor((viewportWidth - gutterWidth - padding * 2) / advance) - 1
  );
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
