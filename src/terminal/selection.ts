/**
 * Selecting and copying text out of the Skia grid, as pure functions.
 *
 * Everything a selection is -- where a finger landed in cell coordinates, which
 * cells lie between two of them, what rectangles cover those cells, and what
 * string comes back out -- lives here rather than in the canvas component, for
 * the same reason `tab-swipe.ts` does: the boundary cases (a wide glyph split
 * down the middle, a row the scrollback window has since dropped, a drag that
 * ran backwards up the pane) are cheaper to pin with tests than with two thumbs
 * on a phone.
 *
 * The hit test and the gesture arbitration below run on the UI thread, so they
 * carry `'worklet'` and take nothing but numbers. Text extraction is a JS-thread
 * job and takes the frame's lines.
 */
import type { TerminalLine } from '@/terminal/types';

/** A cell in the frame's grid: a row index and a column index, both 0-based. */
export type TerminalCellPoint = {
  row: number;
  column: number;
};

/**
 * A selection as the finger made it: where it started and where it is now.
 *
 * Kept un-normalised on purpose. A drag that runs back up the pane past its own
 * anchor is an ordinary thing to do, and the anchor has to stay put through it
 * -- so the ordering is a question asked of a selection (`normalizeSelection`)
 * rather than an invariant imposed on one.
 */
export type TerminalSelection = {
  anchor: TerminalCellPoint;
  focus: TerminalCellPoint;
};

/** One row's worth of selection: `[startColumn, endColumn)`. */
export type TerminalSelectionSpan = {
  row: number;
  startColumn: number;
  endColumn: number;
};

/** A highlight rectangle in content coordinates, before the canvas transform. */
export type TerminalSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Everything needed to turn a point on the glass into a cell, and back.
 *
 * The same numbers the canvas's own transform is built from, so a hit test and
 * a highlight cannot drift apart: whatever the pinch and the pan have done, the
 * cell under the finger is the cell the reader sees under it.
 */
export type TerminalGridGeometry = {
  cellWidth: number;
  lineHeight: number;
  scale: number;
  translateX: number;
  translateY: number;
  horizontalPadding: number;
  verticalPadding: number;
};

/**
 * Only what selecting reads of a row, so the tests need no emulator: a
 * `TerminalLine` satisfies this, and so does a literal.
 *
 * `cells` is the row's *content*, not its render: `text` is the grapheme the
 * agent printed, and a continuation cell of a wide glyph is `width: 0`. The
 * renderer's substitutions, its fallback shaping and its synthesised bold never
 * reach it, which is the whole reason copy reads cells rather than runs.
 */
export type SelectableLine = {
  cells: readonly { text: string; width: number }[];
};

/**
 * How long a finger has to rest before the pane starts selecting.
 *
 * The platform figure, and the one every text field on both OSes uses. In
 * practice the pane answers at about 600ms rather than 500: the tap that opens
 * links is exclusive with this and does not fail until its own 600ms
 * `maxDuration` is up, so the long press is still waiting its turn until then.
 * That is the right trade -- a link tap must never wait on a long press -- and
 * the haptic marks the moment either way.
 */
export const TERMINAL_LONG_PRESS_MS = 500;

/**
 * How far the finger may drift and still be a long press.
 *
 * Matches the tap's own `maxDistance`, so the two agree on what "did not move"
 * means and there is no window where a contact is too still to be a drag and
 * too loose to be a press.
 */
export const TERMINAL_LONG_PRESS_SLOP = 12;

/**
 * How much of the text the highlight is allowed to take.
 *
 * A terminal selection has to leave its own text readable -- the reader is
 * checking what they grabbed, not admiring the tint -- so this is a wash rather
 * than a fill. The colour underneath is the theme's `selection` token.
 */
export const TERMINAL_SELECTION_OPACITY = 0.34;

/** Screen-space band that turns an active selection drag into auto-scroll. */
export const TERMINAL_SELECTION_EDGE_ZONE = 48;

/** Fast enough to cross a long pane, capped so the focus never becomes hard to place. */
export const TERMINAL_SELECTION_MAX_SCROLL_PX_PER_SECOND = 720;

/* ── Hit testing ───────────────────────────────────────────────────────── */

/**
 * The cell under a point in the canvas's own coordinates.
 *
 * The inverse of the transform the content is drawn with -- translate, then
 * scale -- and clamped to the grid, so a finger that leaves the pane's content
 * keeps selecting from its edge instead of returning a row that is not there.
 *
 * Deliberately not snapped to the device pixel the way the draw transform is:
 * that snap moves the picture by up to half a device pixel, which is two orders
 * of magnitude below the width of a cell and cannot change which one a fingertip
 * is over.
 */
export function cellAtViewportPoint(
  x: number,
  y: number,
  geometry: TerminalGridGeometry,
  rows: number,
  columns: number
): TerminalCellPoint {
  'worklet';
  const scale = geometry.scale > 0 ? geometry.scale : 1;
  const cellWidth = geometry.cellWidth > 0 ? geometry.cellWidth : 1;
  const lineHeight = geometry.lineHeight > 0 ? geometry.lineHeight : 1;
  const contentX = (x - geometry.translateX) / scale - geometry.horizontalPadding;
  const contentY = (y - geometry.translateY) / scale - geometry.verticalPadding;
  const lastRow = rows > 0 ? rows - 1 : 0;
  const lastColumn = columns > 0 ? columns - 1 : 0;
  return {
    row: Math.max(0, Math.min(lastRow, Math.floor(contentY / lineHeight))),
    column: Math.max(0, Math.min(lastColumn, Math.floor(contentX / cellWidth))),
  };
}

/** Reading order: earlier row first, then earlier column. */
export function compareCellPoints(left: TerminalCellPoint, right: TerminalCellPoint): number {
  'worklet';
  if (left.row !== right.row) return left.row - right.row;
  return left.column - right.column;
}

/** The same selection with its ends in reading order. */
export function normalizeSelection(selection: TerminalSelection): {
  start: TerminalCellPoint;
  end: TerminalCellPoint;
} {
  'worklet';
  return compareCellPoints(selection.anchor, selection.focus) <= 0
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
}

/**
 * Content translation velocity while a selection finger approaches a visible edge.
 *
 * Positive moves the content down towards earlier rows at the top; negative
 * moves it up towards later rows at the bottom. The ramp starts inside the
 * viewport instead of only after the finger has left it, because both Android
 * and iOS can stop delivering useful outside coordinates at a system edge.
 */
export function selectionAutoScrollVelocity(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number
): number {
  'worklet';
  const height = Math.max(0, viewportBottom - viewportTop);
  const edge = Math.min(TERMINAL_SELECTION_EDGE_ZONE, height / 2);
  if (edge <= 0) return 0;
  const topDistance = viewportTop + edge - pointerY;
  if (topDistance > 0) {
    return TERMINAL_SELECTION_MAX_SCROLL_PX_PER_SECOND * Math.min(1, topDistance / edge);
  }
  const bottomDistance = pointerY - (viewportBottom - edge);
  if (bottomDistance > 0) {
    return -TERMINAL_SELECTION_MAX_SCROLL_PX_PER_SECOND * Math.min(1, bottomDistance / edge);
  }
  return 0;
}

/* ── Telling selecting from panning ────────────────────────────────────── */

/**
 * What a one-or-more-finger drag over the pane means right now.
 *
 * The two states are mutually exclusive by construction rather than by
 * threshold: a pane that is not selecting pans, and a pane that is selecting
 * moves the far end of its selection. There is no gesture that does both and no
 * distance at which one becomes the other, which is what stops the page sliding
 * out from under a reader who is dragging across a line they mean to copy.
 *
 * A second finger is neither. Pinching and the two-finger tab swipe are the
 * canvas's own gestures and run simultaneously with this one; a selection drag
 * that has grown a second finger has stopped being a selection drag, and the
 * quiet answer is to leave the transform to them rather than to yank the
 * selection's far end to wherever the centroid moved.
 */
export type TerminalDragIntent = 'pan' | 'extend-selection' | 'ignore';

export function terminalDragIntent(selecting: boolean, pointerCount: number): TerminalDragIntent {
  'worklet';
  if (!selecting) return 'pan';
  return pointerCount <= 1 ? 'extend-selection' : 'ignore';
}

/**
 * Whether a long press that has just fired is allowed to start a selection.
 *
 * The recogniser's own `maxDistance` already rejects a press that travelled,
 * which covers the ordinary case of a scroll. These are the ones it cannot see:
 *
 *  * **A second finger.** `numberOfPointers(1)` asks for one finger, not for
 *    exactly one at every instant, so a pinch whose fingers land a moment apart
 *    can still arm this.
 *  * **A pan that has already committed to an axis.** The finger is inside the
 *    slop but the pane is mid-drag, and turning that into a selection would
 *    strand the reader halfway down a scroll.
 *  * **A fling still coasting.** The content is moving fast under a finger that
 *    has only just landed, so the cell under it is not the cell the reader
 *    aimed at. A press here means "stop", which is what putting a finger down
 *    already does.
 */
export function longPressArms(state: {
  pointerCount: number;
  panning: boolean;
  pinching: boolean;
  coasting: boolean;
}): boolean {
  'worklet';
  if (state.pointerCount !== 1) return false;
  if (state.pinching) return false;
  if (state.panning) return false;
  return !state.coasting;
}

/**
 * Whether a two-finger tab swipe should take the selection with it.
 *
 * It should. The swipe lands the reader on another tab entirely, and a
 * selection left floating over output it was never made from is at best noise
 * and at worst a wrong copy.
 */
export function tabSwipeClearsSelection(selecting: boolean, moved: boolean): boolean {
  return selecting && moved;
}

/* ── What is selected ──────────────────────────────────────────────────── */

/**
 * The rows a selection covers, one span each.
 *
 * Terminal semantics, not prose semantics: the first row runs from the anchor
 * to the end of its line, every row between is whole, and the last runs from
 * its start to the focus. A single-row selection is the one span between the
 * two columns. That is what makes a dragged selection reproduce the command it
 * was dragged across -- a paragraph-style selection would return a ragged
 * middle and paste back as something the shell never printed.
 *
 * Both ends snap outwards around a wide glyph. A CJK character owns two columns
 * -- the second is a `width: 0` continuation -- and a selection that ends
 * between them would highlight half a glyph and copy the whole one, which reads
 * as the highlight being wrong by a column.
 */
export function selectionSpans(
  lines: readonly SelectableLine[],
  selection: TerminalSelection,
  columns: number
): TerminalSelectionSpan[] {
  const rows = lines.length;
  if (rows === 0 || columns <= 0) return [];
  const { start, end } = normalizeSelection(selection);
  const firstRow = Math.max(0, Math.min(rows - 1, start.row));
  const lastRow = Math.max(0, Math.min(rows - 1, end.row));
  const spans: TerminalSelectionSpan[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const startColumn = row === firstRow ? Math.max(0, start.column) : 0;
    // Exclusive, and the focus cell is inside the selection -- a drag that has
    // not left the cell it started in still selects that one character.
    const endColumn = row === lastRow ? Math.min(columns, end.column + 1) : columns;
    if (endColumn <= startColumn) continue;
    spans.push(snapSpanToGlyphs(lines[row], { row, startColumn, endColumn }, columns));
  }
  return spans;
}

function snapSpanToGlyphs(
  line: SelectableLine,
  span: TerminalSelectionSpan,
  columns: number
): TerminalSelectionSpan {
  const cells = line.cells;
  let { startColumn, endColumn } = span;
  // A continuation cell means the glyph that owns it starts to the left.
  while (startColumn > 0 && startColumn < cells.length && cells[startColumn].width === 0) {
    startColumn -= 1;
  }
  // A wide glyph on the last selected column brings its continuation with it.
  const lastCell = cells[endColumn - 1];
  if (lastCell && lastCell.width === 2 && endColumn < columns) endColumn += 1;
  return { row: span.row, startColumn, endColumn };
}

/**
 * The highlight, as rectangles in content coordinates.
 *
 * Runs of rows that cover the same columns -- which is every row in the middle
 * of a multi-row selection, and all of them under Select all -- collapse into
 * one rectangle. Select all over a full scrollback window is thousands of rows,
 * and thousands of Skia nodes for one flat block of colour is thousands of
 * nodes reconciled per frame for no pixels.
 */
export function selectionRects(
  spans: readonly TerminalSelectionSpan[],
  geometry: {
    cellWidth: number;
    lineHeight: number;
    horizontalPadding: number;
    verticalPadding: number;
  }
): TerminalSelectionRect[] {
  const rects: TerminalSelectionRect[] = [];
  let run: (TerminalSelectionSpan & { rows: number }) | null = null;
  const flush = () => {
    if (!run) return;
    rects.push({
      x: geometry.horizontalPadding + run.startColumn * geometry.cellWidth,
      y: geometry.verticalPadding + run.row * geometry.lineHeight,
      width: (run.endColumn - run.startColumn) * geometry.cellWidth,
      height: run.rows * geometry.lineHeight,
    });
    run = null;
  };
  for (const span of spans) {
    if (
      run &&
      span.row === run.row + run.rows &&
      span.startColumn === run.startColumn &&
      span.endColumn === run.endColumn
    ) {
      run.rows += 1;
      continue;
    }
    flush();
    run = { ...span, rows: 1 };
  }
  flush();
  return rects;
}

/**
 * The selected text, exactly as the agent printed it.
 *
 * Read off `cells`, which is the row's content, never off `runs` or the
 * recorded picture: the renderer swaps in glyphs the bundled font can draw,
 * centres wide characters in their two columns and synthesises bold by stroking
 * an outline, and none of that is text. Cells are also what a wide character
 * survives -- its continuation column carries no text of its own, so skipping
 * zero-width cells is what keeps one CJK character one character instead of
 * one character and a hole.
 *
 * Trailing blanks go, per row. A terminal pads every line to its width, so
 * keeping them would paste a screenful of spaces into the composer for a
 * two-word command. This is the same rule `terminalFrameText` already applies.
 */
export function selectionText(
  lines: readonly SelectableLine[],
  selection: TerminalSelection,
  columns: number
): string {
  const spans = selectionSpans(lines, selection, columns);
  if (spans.length === 0) return '';
  const rows: string[] = [];
  for (const span of spans) {
    const cells = lines[span.row].cells;
    const end = Math.min(span.endColumn, cells.length);
    let text = '';
    for (let column = span.startColumn; column < end; column += 1) {
      const cell = cells[column];
      // Zero width is the second half of a wide glyph: it carries no text, and
      // the glyph itself was emitted by the column that owns it.
      if (cell.width === 0) continue;
      text += cell.text === '' ? ' ' : cell.text;
    }
    rows.push(text.replace(/\s+$/u, ''));
  }
  return rows.join('\n');
}

/**
 * True when the selection covers nothing but blanks -- there is nothing to copy.
 *
 * Answered by looking for the first character rather than by extracting the
 * text and trimming it, because this is asked on every applied frame for as
 * long as a selection is up: a pane streaming under Select all would otherwise
 * rebuild the whole scrollback window as a string ten times a second to
 * discover, every time, that its first row is not empty.
 */
export function selectionIsBlank(
  lines: readonly SelectableLine[],
  selection: TerminalSelection,
  columns: number
): boolean {
  for (const span of selectionSpans(lines, selection, columns)) {
    const cells = lines[span.row].cells;
    const end = Math.min(span.endColumn, cells.length);
    for (let column = span.startColumn; column < end; column += 1) {
      const cell = cells[column];
      if (cell.width === 0) continue;
      if (cell.text !== '' && !/^\s$/u.test(cell.text)) return false;
    }
  }
  return true;
}

/**
 * The word under a cell, as a selection -- what a long press lands on.
 *
 * A press with no drag has to select *something* useful, and one character is
 * not it. Words are whitespace-delimited runs, which in a terminal is the unit
 * that means something: a path, a hash, a flag, a package name. Punctuation is
 * deliberately kept -- `~/src/app.tsx:42` is one thing a reader wants, and a
 * word rule that split it at every slash would hand back `src`.
 *
 * A press on whitespace, or past the end of a row, selects just that cell. The
 * drag that usually follows starts from there and the anchor is where the
 * finger was, which is what a reader expects when they press into a gap.
 */
export function wordSelectionAt(
  lines: readonly SelectableLine[],
  cell: TerminalCellPoint
): TerminalSelection {
  const line = lines[cell.row];
  const single: TerminalSelection = { anchor: cell, focus: cell };
  if (!line) return single;
  const cells = line.cells;
  if (cell.column >= cells.length || isWordBreak(cells[cell.column])) return single;
  let start = cell.column;
  while (start > 0 && !isWordBreak(cells[start - 1])) start -= 1;
  let end = cell.column;
  while (end + 1 < cells.length && !isWordBreak(cells[end + 1])) end += 1;
  return { anchor: { row: cell.row, column: start }, focus: { row: cell.row, column: end } };
}

/** The full terminal row under a cell, from its first through its last cell. */
export function lineSelectionAt(
  lines: readonly SelectableLine[],
  cell: TerminalCellPoint
): TerminalSelection | null {
  if (lines.length === 0) return null;
  const row = Math.max(0, Math.min(lines.length - 1, cell.row));
  const lastColumn = Math.max(0, lines[row].cells.length - 1);
  return {
    anchor: { row, column: 0 },
    focus: { row, column: lastColumn },
  };
}

function isWordBreak(cell: { text: string; width: number } | undefined): boolean {
  if (!cell) return true;
  // A continuation column belongs to the wide glyph on its left, so it is never
  // a break: a run of CJK is one word, not one word per character.
  if (cell.width === 0) return false;
  return cell.text === '' || /^\s$/u.test(cell.text);
}

/**
 * Everything in the pane, as a selection.
 *
 * The far end is the last row's last column rather than the grid's, so Select
 * all followed by a drag inwards starts from where the text ends.
 */
export function selectAllSelection(lines: readonly SelectableLine[]): TerminalSelection | null {
  if (lines.length === 0) return null;
  const lastRow = lines.length - 1;
  const lastColumn = Math.max(0, lines[lastRow].cells.length - 1);
  return { anchor: { row: 0, column: 0 }, focus: { row: lastRow, column: lastColumn } };
}

/**
 * The same selection after the window under it has moved.
 *
 * A pane that is streaming drops a row off the top for every row it prints, and
 * pulling for earlier output pushes every row down by the ones that went in
 * above. Both move the content the selection was made from without changing a
 * character of it, so the selection has to move with it -- otherwise the
 * highlight walks up the pane on its own and Copy returns lines the reader
 * never pointed at. This is the same correction `scroll-anchor` applies to the
 * scroll offset, in the same units, from the same measurement.
 *
 * `null` once the whole selection has left the top of the window: the rows it
 * named are gone, and there is nothing honest to keep highlighted.
 */
export function shiftSelectionRows(
  selection: TerminalSelection,
  droppedRows: number,
  rows: number
): TerminalSelection | null {
  if (droppedRows === 0) return selection;
  const anchorRow = selection.anchor.row - droppedRows;
  const focusRow = selection.focus.row - droppedRows;
  if (anchorRow < 0 && focusRow < 0) return null;
  if (rows > 0 && anchorRow > rows - 1 && focusRow > rows - 1) return null;
  const clampRow = (row: number) => Math.max(0, rows > 0 ? Math.min(rows - 1, row) : row);
  return {
    // An end that has been pushed off the top keeps the selection alive but
    // loses its column: it now begins at the first row still in the window,
    // and it begins at the start of it.
    anchor: { row: clampRow(anchorRow), column: anchorRow < 0 ? 0 : selection.anchor.column },
    focus: { row: clampRow(focusRow), column: focusRow < 0 ? 0 : selection.focus.column },
  };
}

/** Narrowing helper so callers can hand a frame's lines straight in. */
export function asSelectableLines(lines: readonly TerminalLine[]): readonly SelectableLine[] {
  return lines;
}
