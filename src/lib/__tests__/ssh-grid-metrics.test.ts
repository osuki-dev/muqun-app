/**
 * The PTY size is the grid the canvas draws, derived from the same numbers.
 */
import { describe, expect, test } from 'bun:test';

import {
  TERMINAL_GRID_DEFAULT,
  TERMINAL_GRID_MIN_COLS,
  TERMINAL_GRID_MIN_ROWS,
  fallbackTerminalCellWidth,
  terminalGridChanged,
  terminalGridFor,
} from '@/lib/ssh-grid-metrics';
import {
  TERMINAL_ADVANCE_RATIO,
  TERMINAL_GRID_HORIZONTAL_PADDING,
  TERMINAL_GRID_VERTICAL_PADDING,
  terminalLineHeight,
  terminalViewportClearance,
} from '@/terminal/text-scale';

/** The rows that fit once the padding and the canvas's bottom clearance are taken off. */
function rowsFor(height: number, lineHeight: number): number {
  return Math.floor(
    (height - TERMINAL_GRID_VERTICAL_PADDING * 2 - terminalViewportClearance(lineHeight)) /
      lineHeight
  );
}

describe('terminalGridFor', () => {
  test('a phone at the default size, with a measured cell', () => {
    // 402pt wide, 600pt of terminal, 13pt text: 7.8pt cells, 18.9pt rows.
    const grid = terminalGridFor({ width: 402, height: 600, fontSize: 13, cellWidth: 7.8 });
    expect(grid).toEqual({
      cols: Math.floor((402 - TERMINAL_GRID_HORIZONTAL_PADDING * 2) / 7.8),
      rows: rowsFor(600, terminalLineHeight(13)),
    });
    expect(grid.cols).toBe(49);
    expect(grid.rows).toBe(30);
  });

  test('without a measured cell the advance ratio stands in, snapped to the device pixel', () => {
    const fallback = fallbackTerminalCellWidth(13, 3);
    expect(fallback).toBeCloseTo(Math.round(13 * TERMINAL_ADVANCE_RATIO * 3) / 3, 6);
    const grid = terminalGridFor({ width: 402, height: 600, fontSize: 13, pixelRatio: 3 });
    expect(grid.cols).toBe(Math.floor((402 - TERMINAL_GRID_HORIZONTAL_PADDING * 2) / fallback));
  });

  test('the fallback never goes under the canvas floor of 7pt', () => {
    expect(fallbackTerminalCellWidth(8)).toBe(7);
  });

  test('a larger text size fits fewer columns and rows in the same box', () => {
    const small = terminalGridFor({ width: 402, height: 600, fontSize: 12 });
    const large = terminalGridFor({ width: 402, height: 600, fontSize: 16 });
    expect(large.cols).toBeLessThan(small.cols);
    expect(large.rows).toBeLessThan(small.rows);
  });

  test('a viewport that has not been laid out yet clamps to the minimum, not zero', () => {
    expect(terminalGridFor({ width: 0, height: 0, fontSize: 13 })).toEqual({
      cols: TERMINAL_GRID_MIN_COLS,
      rows: TERMINAL_GRID_MIN_ROWS,
    });
  });

  test('an explicit line height overrides the scale rounding', () => {
    const grid = terminalGridFor({
      width: 402,
      height: 400,
      fontSize: 13,
      cellWidth: 8,
      lineHeight: 20,
    });
    expect(grid.rows).toBe(rowsFor(400, 20));
  });

  test('a nonsense cell width falls back rather than dividing by it', () => {
    const grid = terminalGridFor({ width: 402, height: 600, fontSize: 13, cellWidth: 0 });
    expect(grid.cols).toBeGreaterThan(TERMINAL_GRID_MIN_COLS);
    expect(Number.isFinite(grid.cols)).toBe(true);
  });
});

describe('the canvas clearance', () => {
  test('is the room the canvas keeps under its last line, and a full screen fits above it', () => {
    // 13pt text: 18.8pt rows, 19.84pt of clearance -- about one row.
    expect(terminalViewportClearance(terminalLineHeight(13))).toBeCloseTo(19.84, 2);
    const grid = terminalGridFor({ width: 402, height: 600, fontSize: 13, cellWidth: 7.8 });
    expect(
      grid.rows * terminalLineHeight(13) + TERMINAL_GRID_VERTICAL_PADDING * 2
    ).toBeLessThanOrEqual(600 - terminalViewportClearance(terminalLineHeight(13)));
  });
});

describe('terminalGridChanged', () => {
  test('only a moved number is worth a resize', () => {
    expect(terminalGridChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
    expect(terminalGridChanged({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true);
    expect(terminalGridChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 23 })).toBe(true);
  });

  test('the opening size is a classic 80x24', () => {
    expect(TERMINAL_GRID_DEFAULT).toEqual({ cols: 80, rows: 24 });
  });
});

describe('the advance ratio a reader brought with their font', () => {
  test('sizes the estimate, so the first frame is about the loaded face', () => {
    // Only read until the canvas reports a measured cell -- but the first
    // frame is the one the shell draws its prompt into, and everything it
    // printed before the resize landed is already wrapped to that width.
    const wide = terminalGridFor({ width: 402, height: 600, fontSize: 13, advanceRatio: 1 });
    const bundled = terminalGridFor({ width: 402, height: 600, fontSize: 13 });
    const narrow = terminalGridFor({ width: 402, height: 600, fontSize: 13, advanceRatio: 0.5 });

    // A full-width Han mono face at 1.0 fits a little over half the columns
    // the bundled font's 0.6 would have opened the PTY at.
    expect(wide.cols).toBeLessThan(bundled.cols);
    expect(narrow.cols).toBeGreaterThan(bundled.cols);
  });

  test('leaves every existing caller exactly where it was', () => {
    // The parameter defaults to the bundled font's own 0.6, which is what
    // every call site passed implicitly before the monospace slot existed.
    expect(terminalGridFor({ width: 402, height: 600, fontSize: 13 })).toEqual(
      terminalGridFor({
        width: 402,
        height: 600,
        fontSize: 13,
        advanceRatio: TERMINAL_ADVANCE_RATIO,
      })
    );
    expect(fallbackTerminalCellWidth(13, 3)).toBe(
      fallbackTerminalCellWidth(13, 3, TERMINAL_ADVANCE_RATIO)
    );
  });

  test('ignores a ratio that is not one, rather than dividing by it', () => {
    // A slot from a build that stored nonsense, or a face that reported a zero
    // advance: the bundled font's number is the safe answer, not a grid of one
    // column or of infinity.
    const sane = fallbackTerminalCellWidth(13, 3);
    for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fallbackTerminalCellWidth(13, 3, ratio)).toBe(sane);
    }
  });

  test('is ignored entirely once the canvas has measured a real cell', () => {
    // The estimate is a stand-in, never a correction applied on top of the
    // measurement: a measured advance wins whatever the stored ratio says.
    expect(
      terminalGridFor({ width: 402, height: 600, fontSize: 13, cellWidth: 7.8, advanceRatio: 1 })
    ).toEqual(terminalGridFor({ width: 402, height: 600, fontSize: 13, cellWidth: 7.8 }));
  });
});
