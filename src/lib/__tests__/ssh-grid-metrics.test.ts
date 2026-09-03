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
