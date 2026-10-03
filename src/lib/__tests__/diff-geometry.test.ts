import { describe, expect, test } from 'bun:test';

import { cellsOf, gutterNumbersOf, gutterWidthOf, TAB_CELLS } from '../diff-geometry';

const line = (oldLine: number | null, newLine: number | null) => ({
  type: 'line',
  oldLine,
  newLine,
});

describe('cellsOf', () => {
  test('plain ASCII is its length', () => {
    expect(cellsOf('')).toBe(0);
    expect(cellsOf('const a = 1;')).toBe(12);
  });

  test(`a tab counts as ${TAB_CELLS} cells`, () => {
    expect(cellsOf('\t\tx')).toBe(2 * TAB_CELLS + 1);
  });

  test('a wide character counts as two cells, a surrogate pair as one glyph', () => {
    expect(cellsOf('漢字x')).toBe(5);
    expect(cellsOf('x😀')).toBe(3);
  });
});

describe('gutterNumbersOf', () => {
  test('an untracked file has one side and at least two digits', () => {
    expect(gutterNumbersOf([line(null, 1), line(null, 9)])).toEqual({
      digits: 2,
      numberColumns: 1,
    });
  });

  test('a deleted file has one side too', () => {
    expect(gutterNumbersOf([line(1, null), line(448, null)])).toEqual({
      digits: 3,
      numberColumns: 1,
    });
  });

  test('two columns once both sides appear anywhere, digits of the largest number', () => {
    expect(gutterNumbersOf([line(12, 12), line(null, 10234)])).toEqual({
      digits: 5,
      numberColumns: 2,
    });
    // No row carries both, but old and new numbers are both in the list.
    expect(gutterNumbersOf([line(7, null), line(null, 7)]).numberColumns).toBe(2);
  });

  test('ignores rows that are not lines', () => {
    expect(gutterNumbersOf([{ type: 'file' }, { type: 'hunk' }, line(null, 3)])).toEqual({
      digits: 2,
      numberColumns: 1,
    });
    expect(gutterNumbersOf([])).toEqual({ digits: 2, numberColumns: 1 });
  });
});

describe('gutterWidthOf', () => {
  const base = { numberAdvance: 5.7, markerWidth: 8, inset: 6, gap: 2 };

  test('one side, three digits is well under the old fixed 78', () => {
    const { width, numberWidth } = gutterWidthOf({ ...base, digits: 3, numberColumns: 1 });
    expect(numberWidth).toBe(Math.ceil(3 * 5.7));
    expect(width).toBe(numberWidth + 2 + 8 + 6);
    expect(width).toBeLessThan(40);
  });

  test('two columns double the number part', () => {
    const one = gutterWidthOf({ ...base, digits: 4, numberColumns: 1 });
    const two = gutterWidthOf({ ...base, digits: 4, numberColumns: 2 });
    expect(two.width - one.width).toBe(one.numberWidth + base.gap);
  });
});
