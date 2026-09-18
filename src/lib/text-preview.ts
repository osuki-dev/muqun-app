/**
 * What the app will preview as text, and how a file becomes rows.
 *
 * Three numbers and the arithmetic around them. Each number decides something a
 * reader sees -- whether a file opens at all, whether it is coloured, how far
 * one line is drawn -- and each has an argument behind it, which is why they
 * live together here and not one apiece in the component that happens to read
 * them. Pure, and therefore tested: the components decide nothing.
 *
 * The line index is here for the same reason. It has to be exact, because every
 * row's identity, the gutter's numbering and the content width all come from
 * it.
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
 *
 * The size at which a file stops going to the markdown renderer and starts
 * coming here lives at the top of this file for the same reason: it is a number
 * with an argument behind it, and a component is the wrong place to keep one.
 */

/**
 * The ceiling on a text-ish asset read, and the one number the viewer refuses
 * at.
 *
 * It used to be 512 KiB, and the viewer refused to *draw* anything past 64 KiB
 * -- so a 100 KB file was fetched over the wire, held whole in the JS heap, and
 * then replaced with a sentence saying it was too large. There is no drawing
 * gate any more: a document is drawn a block at a time and a source file a line
 * at a time, so what the viewer can show is simply what the phone can hold.
 *
 * Five MiB is what that turns out to be worth. A megabyte of text is 20 000
 * lines and a `bun.lock`; five is a limit nothing an agent writes has ever come
 * near. It is under the gateway's own 10 MiB asset ceiling
 * (`MAX_ASSET_CONTENT_BYTES`) and under what its encrypted transport will
 * buffer, so the app's refusal is the first one the reader meets and it is the
 * one that can explain itself. The cost is real and bounded: a JS string is
 * UTF-16, so five MiB of source is about ten of heap, held only while the file
 * is open.
 *
 * The gateway caps this too, but a phone is the side that runs out of memory,
 * so the app refuses oversized files before asking for them rather than after
 * receiving them.
 */
export const MAX_ASSET_TEXT_BYTES = 5 * 1024 * 1024;

/**
 * Where a file stops being highlighted and starts being drawn as lines.
 *
 * Not where it stops being drawn. There is no size at which the asset viewer
 * refuses a text file any more, short of `MAX_ASSET_TEXT_BYTES` -- what changes
 * at this number is which renderer draws it, and the reason is iOS.
 *
 * `react-native-enriched-markdown` parses and lays out natively -- the
 * tree-sitter highlighter never touches the JS thread -- but the layout still
 * lands in one uninterruptible pass before anything is on screen, and past a
 * point it stops being linear. Measured through the asset viewer on a warm app,
 * from the string being in hand to the renderer's first layout, one fenced
 * TypeScript block per file, each size a file the app had not opened before:
 *
 *   size        iOS simulator    Android emulator
 *    20 KiB            101 ms              185 ms
 *    60 KiB            806 ms              127 ms
 *    96 KiB          1_869 ms              249 ms
 *   128 KiB          3_746 ms              209 ms
 *   160 KiB          5_847 ms              390 ms
 *   200 KiB          7_920 ms              141 ms
 *
 * Android is flat and cheap at every size. iOS is quadratic, and at 200 KiB the
 * sheet shows its loading skeleton for eight seconds and then a screenful of
 * code. That is not a slow render, it is the reader waiting at a placeholder,
 * and it is the shape card #661 reported.
 *
 * 64 KiB is the last size on the flat part of that curve -- under a second --
 * so it stays, and every file under it is drawn exactly as it was: one fenced
 * block, highlighted natively, selectable, nothing changed. What is new is the
 * other side. A file above it goes to `CodeLinesView`, which is a virtualized
 * list of monospaced rows and costs the screenful on screen rather than the
 * file, so 170 KB and 2 MB open in the same time as 20 KB. It has no colour in
 * it, and the viewer says so.
 *
 * Highlighting the visible window instead was the alternative, and it loses.
 * The only highlighter in this app is inside the native fenced block; feeding
 * it a window at a time means a nested horizontal scroller per window, so
 * columns stop agreeing down the file, a height that cannot be predicted, so
 * the fixed row geometry that makes the list smooth goes with it, and a native
 * re-parse several times a second on a fling. Colour on the files an agent
 * writes, and a file that opens at all on the files it does not, is the better
 * half of that trade -- and it is strictly more than the refusal it replaces.
 *
 * Characters, not bytes, and deliberately: what the renderer measures is
 * glyphs. Real bytes are what `MAX_ASSET_TEXT_BYTES` gates on, one layer down,
 * where `asset.size` is a real file size.
 */
export const HIGHLIGHT_MAX_CHARS = 64 * 1024;

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
