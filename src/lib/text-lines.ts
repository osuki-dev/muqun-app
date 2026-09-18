/**
 * A file, as the rows a virtualized viewer draws.
 *
 * The code viewer is a list of lines, not one string handed to one text node,
 * so something has to turn the string into lines -- and that something has to
 * be exact, because every row's identity, the gutter's numbering and the
 * content width all come from it. It is pure, and therefore tested: the
 * component that draws the rows decides nothing.
 *
 * Three details that are easy to get wrong and impossible to miss once they
 * are:
 *
 *  * A file that ends in a newline does not have a last empty line. `split`
 *    says it does, and drawing it puts a phantom row with a line number under
 *    every well-formed file in the repository.
 *  * `\r` is the other half of a CRLF terminator, not a character in the line.
 *    Left in, it measures as a glyph, so every line of a Windows file is one
 *    cell wider than it is and the horizontal extent is wrong by a column.
 *  * One line can be the whole file. A minified bundle is one line of a
 *    megabyte, and a text node handed a megabyte measures for seconds. What
 *    goes to the row is clamped; what goes to the clipboard is not.
 */

/**
 * How many characters of one line are drawn.
 *
 * Past this the row shows an ellipsis. It is not a guess about readability --
 * four thousand columns is already forty screens wide -- it is about what a
 * single native text node can be asked to measure on a fling. The header's copy
 * action still has the whole file, which is what anyone wanting the rest of a
 * minified line actually needs.
 */
export const MAX_LINE_COLUMNS = 4_000;

export interface TextLineIndex {
  lines: readonly string[];
  /** Characters in the longest line, before any display clamp. */
  longest: number;
}

const NO_LINES: TextLineIndex = { lines: [], longest: 0 };

/** The lines of a file, terminators removed, and the widest one's length. */
export function indexTextLines(text: string): TextLineIndex {
  if (typeof text !== 'string' || text.length === 0) return NO_LINES;
  const lines = text.split('\n');
  // The terminator of the last line, not an empty line after it.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  let longest = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.charCodeAt(line.length - 1) === 13) lines[index] = line.slice(0, -1);
    if (lines[index].length > longest) longest = lines[index].length;
  }
  return { lines, longest };
}

/** What one row is allowed to draw of a line that is longer than the screen. */
export function clampLine(line: string, columns: number = MAX_LINE_COLUMNS): string {
  return line.length > columns ? `${line.slice(0, columns)}…` : line;
}

/** Room for the largest line number the file will ask the gutter to draw. */
export function gutterDigits(lineCount: number): number {
  return Math.max(2, String(Math.max(lineCount, 1)).length);
}

export interface LineGeometry {
  /** Characters in the longest line, from `indexTextLines`. */
  longest: number;
  /** Points one character occupies, measured from the row's own face. */
  advance: number;
  /** The pinned column the line numbers sit in. */
  gutter: number;
  /** The row's left and right breathing room. */
  padding: number;
  /** What the reader can see; the content is never narrower than this. */
  viewport: number;
  /** The per-line display clamp, so the extent matches what a row can draw. */
  columns?: number;
}

/**
 * How wide the scrolled content is, in points.
 *
 * The longest line decides it, clamped the same way a row is clamped -- a
 * minified bundle's one 900 KB line must not ask the platform for a scroll view
 * six million points wide, and a row would not draw past the clamp anyway. Two
 * cells of slack, for the reason `diff-rows` records: the advance is measured
 * and not exact, and a content width a hair under the true one puts an ellipsis
 * on the single longest line in the file, which is reliably the line the reader
 * scrolled right to see.
 */
export function lineContentWidth({
  longest,
  advance,
  gutter,
  padding,
  viewport,
  columns = MAX_LINE_COLUMNS,
}: LineGeometry): number {
  const cells = Math.min(longest, columns) + 2;
  return Math.max(viewport, gutter + cells * advance + padding * 2);
}
