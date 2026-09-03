// Selecting and copying text out of the Skia grid.
//
// Two halves. The first is arbitration: a pane that pans and a pane that
// selects are the same pane and the same finger, and the rules that keep them
// apart have to be exact rather than nearly right -- the failure mode is the
// page sliding out from under a reader mid-drag, which is the complaint the
// whole card came from. The second is the selection model: which cells lie
// between two points under terminal semantics, and what string comes back,
// including the cases a thumb cannot easily reproduce (a CJK glyph split down
// the middle, a scrollback window that trimmed the rows underneath it).
import { describe, expect, test } from 'bun:test';

import {
  TERMINAL_LONG_PRESS_MS,
  TERMINAL_LONG_PRESS_SLOP,
  cellAtViewportPoint,
  compareCellPoints,
  lineSelectionAt,
  longPressArms,
  normalizeSelection,
  selectAllSelection,
  selectionIsBlank,
  selectionAutoScrollVelocity,
  selectionRects,
  selectionSpans,
  selectionText,
  shiftSelectionRows,
  tabSwipeClearsSelection,
  terminalDragIntent,
  wordSelectionAt,
  type SelectableLine,
  type TerminalSelection,
} from '@/terminal/selection';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';
import { DEFAULT_TERMINAL_THEME } from '@/terminal/palette';

/**
 * A row built the way the emulator builds one: a wide character owns two
 * columns, the second of which is a zero-width continuation carrying no text.
 */
function row(text: string): SelectableLine {
  const cells: { text: string; width: number }[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const wide = code >= 0x2e80 && code <= 0xd7a3;
    cells.push({ text: character, width: wide ? 2 : 1 });
    if (wide) cells.push({ text: '', width: 0 });
  }
  return { cells };
}

function rows(...texts: string[]): SelectableLine[] {
  return texts.map(row);
}

function span(anchor: [number, number], focus: [number, number]): TerminalSelection {
  return {
    anchor: { row: anchor[0], column: anchor[1] },
    focus: { row: focus[0], column: focus[1] },
  };
}

const geometry = {
  cellWidth: 8,
  lineHeight: 18,
  scale: 1,
  translateX: 0,
  translateY: 0,
  horizontalPadding: 7,
  verticalPadding: 8,
};

/* ── Hit testing ───────────────────────────────────────────────────────── */

describe('cellAtViewportPoint', () => {
  test('lands on the cell the reader is looking at', () => {
    // Column 3 spans x in [7 + 24, 7 + 32); row 2 spans y in [8 + 36, 8 + 54).
    expect(cellAtViewportPoint(7 + 25, 8 + 37, geometry, 40, 80)).toEqual({ row: 2, column: 3 });
  });

  test('undoes the pan and the pinch, in that order', () => {
    // The canvas translates then scales, so a point at twice the zoom is half
    // as far into the content as its distance from the origin suggests.
    const zoomed = { ...geometry, scale: 2, translateX: -100, translateY: -200 };
    const cell = cellAtViewportPoint(-100 + 2 * (7 + 25), -200 + 2 * (8 + 37), zoomed, 40, 80);
    expect(cell).toEqual({ row: 2, column: 3 });
  });

  test('clamps a finger past the content to the edge of the grid', () => {
    expect(cellAtViewportPoint(-500, -500, geometry, 40, 80)).toEqual({ row: 0, column: 0 });
    expect(cellAtViewportPoint(99999, 99999, geometry, 40, 80)).toEqual({ row: 39, column: 79 });
  });

  test('survives an empty pane rather than returning a row that is not there', () => {
    expect(cellAtViewportPoint(120, 120, geometry, 0, 0)).toEqual({ row: 0, column: 0 });
  });

  test('does not divide by a zero cell before the font has loaded', () => {
    const unmeasured = { ...geometry, cellWidth: 0, lineHeight: 0, scale: 0 };
    const cell = cellAtViewportPoint(120, 120, unmeasured, 40, 80);
    expect(Number.isFinite(cell.row)).toBe(true);
    expect(Number.isFinite(cell.column)).toBe(true);
  });
});

describe('normalizeSelection', () => {
  test('leaves a forward selection alone', () => {
    const selection = span([2, 4], [5, 9]);
    expect(normalizeSelection(selection)).toEqual({
      start: { row: 2, column: 4 },
      end: { row: 5, column: 9 },
    });
  });

  test('orders a drag that ran back up the pane', () => {
    expect(normalizeSelection(span([5, 9], [2, 4]))).toEqual({
      start: { row: 2, column: 4 },
      end: { row: 5, column: 9 },
    });
  });

  test('orders by column within one row', () => {
    expect(normalizeSelection(span([3, 20], [3, 4])).start).toEqual({ row: 3, column: 4 });
  });

  test('compares in reading order', () => {
    expect(compareCellPoints({ row: 1, column: 99 }, { row: 2, column: 0 })).toBeLessThan(0);
    expect(compareCellPoints({ row: 2, column: 5 }, { row: 2, column: 5 })).toBe(0);
  });
});

/* ── Arbitration ───────────────────────────────────────────────────────── */

describe('terminalDragIntent', () => {
  test('a pane that is not selecting pans, whatever is on the glass', () => {
    expect(terminalDragIntent(false, 1)).toBe('pan');
    expect(terminalDragIntent(false, 2)).toBe('pan');
  });

  test('a pane that is selecting never pans', () => {
    expect(terminalDragIntent(true, 1)).toBe('extend-selection');
  });

  test('a second finger is neither -- the pinch and the tab swipe own it', () => {
    expect(terminalDragIntent(true, 2)).toBe('ignore');
    expect(terminalDragIntent(true, 3)).toBe('ignore');
  });

  test('the two states are exhaustive and disjoint', () => {
    for (const selecting of [false, true]) {
      for (let pointers = 0; pointers <= 4; pointers += 1) {
        const intent = terminalDragIntent(selecting, pointers);
        expect(intent === 'pan').toBe(!selecting);
        if (selecting) expect(intent === 'extend-selection').toBe(pointers <= 1);
      }
    }
  });
});

describe('longPressArms', () => {
  const still = { pointerCount: 1, panning: false, pinching: false, coasting: false };

  test('arms on one still finger', () => {
    expect(longPressArms(still)).toBe(true);
  });

  test('does not arm under a second finger', () => {
    expect(longPressArms({ ...still, pointerCount: 2 })).toBe(false);
    expect(longPressArms({ ...still, pointerCount: 0 })).toBe(false);
  });

  test('does not arm mid-pinch', () => {
    expect(longPressArms({ ...still, pinching: true })).toBe(false);
  });

  test('does not arm once a pan has committed to an axis', () => {
    expect(longPressArms({ ...still, panning: true })).toBe(false);
  });

  test('does not arm on a finger that landed to stop a fling', () => {
    expect(longPressArms({ ...still, coasting: true })).toBe(false);
  });

  test('any one blocker is enough', () => {
    for (const blocker of ['panning', 'pinching', 'coasting'] as const) {
      expect(longPressArms({ ...still, [blocker]: true })).toBe(false);
    }
  });
});

describe('tabSwipeClearsSelection', () => {
  test('a swipe that lands on another tab takes the selection with it', () => {
    expect(tabSwipeClearsSelection(true, true)).toBe(true);
  });

  test('a swipe that went nowhere leaves it alone', () => {
    expect(tabSwipeClearsSelection(true, false)).toBe(false);
  });

  test('nothing to clear when nothing is selected', () => {
    expect(tabSwipeClearsSelection(false, true)).toBe(false);
  });
});

describe('gesture constants', () => {
  test('the press is the platform figure and its slop matches the tap', () => {
    expect(TERMINAL_LONG_PRESS_MS).toBe(500);
    expect(TERMINAL_LONG_PRESS_SLOP).toBe(12);
  });
});

describe('selectionAutoScrollVelocity', () => {
  test('stands still away from both visible edges', () => {
    expect(selectionAutoScrollVelocity(300, 100, 700)).toBe(0);
  });

  test('moves towards earlier rows at the top and later rows at the bottom', () => {
    expect(selectionAutoScrollVelocity(110, 100, 700)).toBeGreaterThan(0);
    expect(selectionAutoScrollVelocity(690, 100, 700)).toBeLessThan(0);
  });

  test('ramps with edge distance and caps once the finger leaves the viewport', () => {
    const nearTop = selectionAutoScrollVelocity(140, 100, 700);
    const atTop = selectionAutoScrollVelocity(100, 100, 700);
    const outsideTop = selectionAutoScrollVelocity(-500, 100, 700);
    expect(atTop).toBeGreaterThan(nearTop);
    expect(outsideTop).toBe(atTop);
    expect(selectionAutoScrollVelocity(900, 100, 700)).toBe(-atTop);
  });
});

/* ── What is selected ──────────────────────────────────────────────────── */

describe('selectionSpans', () => {
  const lines = rows('alpha', 'bravo', 'charlie');

  test('one row selects between the two columns, inclusive of the focus', () => {
    expect(selectionSpans(lines, span([0, 1], [0, 3]), 80)).toEqual([
      { row: 0, startColumn: 1, endColumn: 4 },
    ]);
  });

  test('a press that never moved still selects its own cell', () => {
    expect(selectionSpans(lines, span([1, 2], [1, 2]), 80)).toEqual([
      { row: 1, startColumn: 2, endColumn: 3 },
    ]);
  });

  test('runs to the end of the line and takes whole rows in between', () => {
    expect(selectionSpans(lines, span([0, 2], [2, 3]), 80)).toEqual([
      { row: 0, startColumn: 2, endColumn: 80 },
      { row: 1, startColumn: 0, endColumn: 80 },
      { row: 2, startColumn: 0, endColumn: 4 },
    ]);
  });

  test('a backwards drag selects the same rows as the forwards one', () => {
    expect(selectionSpans(lines, span([2, 3], [0, 2]), 80)).toEqual(
      selectionSpans(lines, span([0, 2], [2, 3]), 80)
    );
  });

  test('clamps to the rows the frame actually has', () => {
    const spans = selectionSpans(lines, span([0, 0], [99, 4]), 80);
    expect(spans).toHaveLength(3);
    expect(spans[spans.length - 1].row).toBe(2);
  });

  test('an empty frame selects nothing', () => {
    expect(selectionSpans([], span([0, 0], [3, 3]), 80)).toEqual([]);
  });
});

describe('selectionSpans with wide glyphs', () => {
  // 你好 occupies columns 0..3; 'ok' follows at 4 and 5.
  const lines = rows('你好ok');

  test('an end landing on a continuation column takes the whole glyph', () => {
    // Focus on column 1, the second half of 你.
    expect(selectionSpans(lines, span([0, 0], [0, 1]), 80)).toEqual([
      { row: 0, startColumn: 0, endColumn: 2 },
    ]);
  });

  test('a start landing on a continuation column steps back onto the glyph', () => {
    expect(selectionSpans(lines, span([0, 3], [0, 5]), 80)).toEqual([
      { row: 0, startColumn: 2, endColumn: 6 },
    ]);
  });
});

describe('selectionText', () => {
  test('returns the run of characters between the two ends', () => {
    expect(selectionText(rows('alpha bravo'), span([0, 6], [0, 10]), 80)).toBe('bravo');
  });

  test('joins rows with newlines and keeps the whole middle', () => {
    const lines = rows('one', 'two', 'three');
    expect(selectionText(lines, span([0, 1], [2, 2]), 80)).toBe('ne\ntwo\nthr');
  });

  test('drops the padding a terminal writes to the right of every line', () => {
    // Selecting to column 80 on a three-character row must not paste 77 spaces.
    expect(selectionText(rows('one', 'two'), span([0, 0], [1, 79]), 80)).toBe('one\ntwo');
  });

  test('a wide character comes back as one character, not one and a hole', () => {
    expect(selectionText(rows('你好ok'), span([0, 0], [0, 5]), 80)).toBe('你好ok');
  });

  test('round-trips a CJK row through a real parse', () => {
    const frame = parseTerminalSnapshot('項目 已完成 ✓\n', DEFAULT_TERMINAL_THEME);
    const selection = selectAllSelection(frame.lines);
    expect(selection).not.toBeNull();
    expect(selectionText(frame.lines, selection as TerminalSelection, frame.columns)).toContain(
      '項目 已完成 ✓'
    );
  });

  test('copies the character the agent printed, not the one the font drew', () => {
    // U+2714 is absent from the bundled font and is drawn as U+2713. That is a
    // rendering decision and must not reach the clipboard.
    const frame = parseTerminalSnapshot('build ✔\n', DEFAULT_TERMINAL_THEME);
    const selection = selectAllSelection(frame.lines);
    const text = selectionText(frame.lines, selection as TerminalSelection, frame.columns);
    expect(text).toContain('✔');
    expect(text).not.toContain('✓');
  });

  test('nothing selected in a frame with no rows', () => {
    expect(selectionText([], span([0, 0], [0, 0]), 80)).toBe('');
  });
});

describe('selectionIsBlank', () => {
  test('true for a highlight that caught only the padding', () => {
    expect(selectionIsBlank(rows('hi'), span([0, 40], [0, 60]), 80)).toBe(true);
  });

  test('false as soon as it holds a character', () => {
    expect(selectionIsBlank(rows('hi'), span([0, 0], [0, 1]), 80)).toBe(false);
  });
});

describe('wordSelectionAt', () => {
  const lines = rows('git commit --amend');

  test('a press in the middle of a word takes the whole word', () => {
    expect(wordSelectionAt(lines, { row: 0, column: 5 })).toEqual(span([0, 4], [0, 9]));
  });

  test('keeps a path or a flag whole rather than splitting on punctuation', () => {
    const paths = rows('open ~/src/app.tsx:42 now');
    const selection = wordSelectionAt(paths, { row: 0, column: 8 });
    expect(selectionText(paths, selection, 80)).toBe('~/src/app.tsx:42');
  });

  test('a press on a space selects just that cell', () => {
    expect(wordSelectionAt(lines, { row: 0, column: 3 })).toEqual(span([0, 3], [0, 3]));
  });

  test('a press past the end of a short row selects just that cell', () => {
    expect(wordSelectionAt(lines, { row: 0, column: 60 })).toEqual(span([0, 60], [0, 60]));
  });

  test('a run of CJK is one word, not one word per character', () => {
    const cjk = rows('說明 文件');
    const selection = wordSelectionAt(cjk, { row: 0, column: 0 });
    expect(selectionText(cjk, selection, 80)).toBe('說明');
  });

  test('a row that is not there is not a crash', () => {
    expect(wordSelectionAt([], { row: 4, column: 2 })).toEqual(span([4, 2], [4, 2]));
  });
});

describe('lineSelectionAt', () => {
  test('takes the entire row under the double tap', () => {
    const lines = rows('short', 'the whole current row', 'tail');
    const selection = lineSelectionAt(lines, { row: 1, column: 8 });
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('expected the current row to be selectable');
    expect(selection).toEqual(span([1, 0], [1, 20]));
    expect(selectionText(lines, selection, 80)).toBe('the whole current row');
  });

  test('clamps a point at either end of the frame', () => {
    const lines = rows('first', 'last');
    expect(lineSelectionAt(lines, { row: -4, column: 0 })).toEqual(span([0, 0], [0, 4]));
    expect(lineSelectionAt(lines, { row: 99, column: 0 })).toEqual(span([1, 0], [1, 3]));
  });

  test('an empty frame has no current line to select', () => {
    expect(lineSelectionAt([], { row: 4, column: 2 })).toBeNull();
  });
});

describe('selectAllSelection', () => {
  test('spans the whole pane', () => {
    const lines = rows('one', 'two', 'three');
    expect(selectAllSelection(lines)).toEqual(span([0, 0], [2, 4]));
  });

  test('nothing to select in an empty pane', () => {
    expect(selectAllSelection([])).toBeNull();
  });
});

/* ── Staying on the content it was made from ───────────────────────────── */

describe('shiftSelectionRows', () => {
  const selection = span([10, 2], [12, 6]);

  test('rides the window up as a streaming pane trims rows off the top', () => {
    expect(shiftSelectionRows(selection, 4, 300)).toEqual(span([6, 2], [8, 6]));
  });

  test('rides back down when pulling for earlier output prepends rows', () => {
    expect(shiftSelectionRows(selection, -5, 300)).toEqual(span([15, 2], [17, 6]));
  });

  test('a frame that dropped nothing is handed straight back', () => {
    expect(shiftSelectionRows(selection, 0, 300)).toBe(selection);
  });

  test('an end that has left the window keeps the selection but loses its column', () => {
    expect(shiftSelectionRows(selection, 11, 300)).toEqual(span([0, 0], [1, 6]));
  });

  test('goes away entirely once every row it named has gone', () => {
    expect(shiftSelectionRows(selection, 40, 300)).toBeNull();
  });
});

/* ── The highlight ─────────────────────────────────────────────────────── */

describe('selectionRects', () => {
  const paints = { cellWidth: 8, lineHeight: 18, horizontalPadding: 7, verticalPadding: 8 };

  test('one span is one rectangle in content coordinates', () => {
    expect(selectionRects([{ row: 2, startColumn: 3, endColumn: 7 }], paints)).toEqual([
      { x: 7 + 24, y: 8 + 36, width: 32, height: 18 },
    ]);
  });

  test('collapses a run of identical rows into one rectangle', () => {
    const spans = [
      { row: 0, startColumn: 4, endColumn: 80 },
      { row: 1, startColumn: 0, endColumn: 80 },
      { row: 2, startColumn: 0, endColumn: 80 },
      { row: 3, startColumn: 0, endColumn: 80 },
      { row: 4, startColumn: 0, endColumn: 9 },
    ];
    const rects = selectionRects(spans, paints);
    expect(rects).toHaveLength(3);
    expect(rects[1]).toEqual({ x: 7, y: 8 + 18, width: 640, height: 54 });
  });

  test('select all over a full window is a handful of nodes, not thousands', () => {
    const spans = Array.from({ length: 2000 }, (_, index) => ({
      row: index,
      startColumn: 0,
      endColumn: 80,
    }));
    expect(selectionRects(spans, paints)).toHaveLength(1);
  });

  test('does not merge across a gap in the rows', () => {
    const rects = selectionRects(
      [
        { row: 0, startColumn: 0, endColumn: 80 },
        { row: 4, startColumn: 0, endColumn: 80 },
      ],
      paints
    );
    expect(rects).toHaveLength(2);
  });

  test('nothing selected paints nothing', () => {
    expect(selectionRects([], paints)).toEqual([]);
  });
});
