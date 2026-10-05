/**
 * Lines that keep the width they were printed at.
 *
 * A gateway pane's scrollback arrives as logical lines (`recent-unwrapped`):
 * whatever the terminal soft-wrapped is handed over joined, and the parse lays
 * it back out at the pane's own width, carrying anything longer onto the next
 * row (`wrapsToNext`). For prose that is the right answer. For a table, a box
 * drawn in box-drawing characters or a block of ANSI art it is not: cut at a
 * column the picture was not drawn for, the right-hand half of every row lands
 * under the left-hand half of the next, and the shape the reader came to look
 * at is gone.
 *
 * So those lines are put back together into one row at their own width, and
 * the frame grows to the widest of them; the canvas already pans a frame wider
 * than the phone (`terminalPanMinX` measures the frame's columns), so every
 * cell stays reachable. Nothing is dropped on the way: each row of a chain is
 * padded back out to the column it wrapped at -- the trailing blanks a row's
 * cells omit, and the empty last column a wide glyph skips -- before the next
 * row is appended. A line that would come out wider than `MAX_GRID_COLUMNS` is
 * left wrapped, which loses nothing either; it is only less pretty.
 *
 * Only for a parsed gateway snapshot of a pane that does not own its screen. A
 * full-screen program's frame is its own grid, and an SSH shell's frame comes
 * from a live emulator whose wraps are the far side's.
 */
import { TerminalGrid } from '@/terminal/grid';
import { MAX_GRID_COLUMNS } from '@/terminal/terminal-core';
import type { TerminalCell, TerminalFrame, TerminalLine } from '@/terminal/types';

/** Box drawing (U+2500-257F) and block elements (U+2580-259F). */
const BOX_DRAWING = /[─-▟]/u;
/** Braille patterns and the legacy-computing symbols: what text-mode art is drawn in. */
const ART_CHARACTERS = /[⠀-⣿\u{1fb00}-\u{1fbff}]/u;
/** Four geometric shapes in a row (■□▲●◆…): a bar, a gauge, a sprite. */
const SHAPE_RUN = /[■-◿]{4}/u;
/** Eight of the same mark in a row: a rule drawn in `=`, `-`, `*`, `~`, `#`. */
const RULE_RUN = /([^\p{L}\p{N}\s])\1{7}/u;
/** A Markdown-style table row's interior separator. */
const SPACED_PIPE = / \| /gu;

/**
 * Whether a logical line is a picture rather than prose: box drawing or block
 * characters, a table row (`| a | b |`, or two ` | ` separators), or text-mode
 * art. Such a line is laid out at its own width and panned, never wrapped.
 */
export function isNativeWidthLine(text: string): boolean {
  if (BOX_DRAWING.test(text) || ART_CHARACTERS.test(text)) return true;
  if (SHAPE_RUN.test(text) || RULE_RUN.test(text)) return true;
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('|') && trimmed.endsWith('|')) return true;
  return (text.match(SPACED_PIPE)?.length ?? 0) >= 2;
}

/**
 * `frame` with every wrapped chain whose joined text `isNativeWidthLine` says
 * is a picture put back onto one row, and `columns` grown to the widest row.
 * The same frame, by identity, when there is nothing to join.
 */
export function keepNativeWidthRows(
  frame: TerminalFrame,
  maxColumns: number = MAX_GRID_COLUMNS
): TerminalFrame {
  const lines = frame.lines;
  let out: TerminalLine[] | null = null;
  let columns = frame.columns;
  let cursorRow = frame.cursor.row;
  let cursorColumn = frame.cursor.column;
  let row = 0;
  while (row < lines.length) {
    let last = row;
    while (lines[last].wrapsToNext && last + 1 < lines.length) last += 1;
    const joined = last > row ? joinChain(lines, row, last, maxColumns) : null;
    if (joined) {
      out ??= lines.slice(0, row);
      const at = out.length;
      if (frame.cursor.row >= row && frame.cursor.row <= last) {
        cursorRow = at;
        cursorColumn = joined.offsets[frame.cursor.row - row] + frame.cursor.column;
      } else if (frame.cursor.row > last) {
        cursorRow -= last - row;
      }
      out.push(joined.line);
      columns = Math.max(columns, joined.width);
    } else if (out) {
      for (let index = row; index <= last; index += 1) out.push(lines[index]);
    }
    row = last + 1;
  }
  if (!out) return frame;
  return {
    ...frame,
    columns,
    rows: out.length,
    lines: out,
    cursor: { ...frame.cursor, row: cursorRow, column: cursorColumn },
  };
}

/** Rows `first`..`last` of one wrap chain as one row, or null to leave them be. */
function joinChain(
  lines: readonly TerminalLine[],
  first: number,
  last: number,
  maxColumns: number
): { line: TerminalLine; width: number; offsets: number[] } | null {
  const cells: (TerminalCell | null)[] = [];
  const offsets: number[] = [];
  let text = '';
  for (let row = first; row <= last; row += 1) {
    const line = lines[row];
    offsets.push(cells.length);
    for (const cell of line.cells) {
      cells.push(cell);
      if (cell.width > 0) text += cell.text === '' ? ' ' : cell.text;
    }
    if (row < last) {
      // The blanks a row's cells leave off, out to where it wrapped -- spaces
      // inside a table cell, or the unused last column before a wide glyph.
      const pad = Math.max(0, (line.wrapsToNext ?? 0) - line.cells.length);
      for (let index = 0; index < pad; index += 1) cells.push(null);
      text += ' '.repeat(pad);
    }
  }
  if (cells.length > maxColumns || !isNativeWidthLine(text)) return null;
  const grid = new TerminalGrid(Math.max(1, cells.length), 1, 0);
  cells.forEach((cell, column) => {
    if (cell) grid.putCell(0, column, cell.text, cell.width, cell.style);
  });
  return { line: grid.lineAt(0), width: cells.length, offsets };
}
