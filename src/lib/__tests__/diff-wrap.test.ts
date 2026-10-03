import { describe, expect, test } from 'bun:test';

import {
  codeColumns,
  gutterNumbersOf,
  gutterWidthOf,
  MIN_COLUMNS,
  TAB_CELLS,
  visualLines,
  wrapForColumns,
} from '../diff-wrap';

const line = (oldLine: number | null, newLine: number | null) => ({
  type: 'line',
  oldLine,
  newLine,
});

describe('visualLines', () => {
  test('an empty or short line is one visual line', () => {
    expect(visualLines('', 10)).toBe(1);
    expect(visualLines('abc', 10)).toBe(1);
    expect(visualLines('x'.repeat(10), 10)).toBe(1);
  });

  test('a long line takes ceil(length / columns) lines', () => {
    expect(visualLines('x'.repeat(11), 10)).toBe(2);
    expect(visualLines('x'.repeat(20), 10)).toBe(2);
    expect(visualLines('x'.repeat(21), 10)).toBe(3);
    expect(visualLines('x'.repeat(448), 40)).toBe(Math.ceil(448 / 40));
  });

  test(`a tab counts as ${TAB_CELLS} cells`, () => {
    expect(visualLines('\t\t', 8)).toBe(1);
    expect(visualLines('\t\tx', 8)).toBe(2);
    expect(visualLines('a\tb\tc', 8)).toBe(2);
  });

  test('a wide character counts as two cells and is never split', () => {
    expect(visualLines('漢字漢字漢', 10)).toBe(1);
    expect(visualLines('漢字漢字漢字', 10)).toBe(2);
    // Nine cells used, a two-cell glyph does not fit in the tenth.
    expect(visualLines('xxxxxxxxx漢', 10)).toBe(2);
  });
});

describe('wrapForColumns', () => {
  test('a line that fits is unchanged', () => {
    expect(wrapForColumns('const a = 1;', 40)).toBe('const a = 1;');
  });

  test('breaks at the cell, not at a space, and every chunk fits', () => {
    const text = 'aaaa bbbb cccc dddd';
    const wrapped = wrapForColumns(text, 6);
    expect(wrapped).toBe('aaaa b\nbbb cc\ncc ddd\nd');
    for (const chunk of wrapped.split('\n')) expect(chunk.length).toBeLessThanOrEqual(6);
  });

  test('draws exactly visualLines lines', () => {
    for (const text of ['', 'x', 'x'.repeat(37), 'a\tb\tc', '\t'.repeat(9), '漢字'.repeat(13)]) {
      for (const columns of [8, 13, 40]) {
        expect(wrapForColumns(text, columns).split('\n').length).toBe(visualLines(text, columns));
      }
    }
  });

  test('expands tabs to spaces so drawn width matches the counted cells', () => {
    expect(wrapForColumns('a\tb', 40)).toBe(`a${' '.repeat(TAB_CELLS)}b`);
    expect(wrapForColumns('\t\tx', 8)).toBe(`${' '.repeat(8)}\nx`);
    expect(wrapForColumns('a\tb\tc', 8)).not.toContain('\t');
  });

  test('keeps a surrogate pair whole', () => {
    const wrapped = wrapForColumns('xxxxxxx😀y', 8);
    expect(wrapped).toBe('xxxxxxx\n😀y');
  });
});

describe('codeColumns', () => {
  test('fits the code column, less one cell of slack', () => {
    // (400 - 34 - 20) / 7 = 49.4 -> 49 - 1
    expect(codeColumns({ viewportWidth: 400, gutterWidth: 34, padding: 10, advance: 7 })).toBe(48);
  });

  test('never drops below the minimum', () => {
    expect(codeColumns({ viewportWidth: 60, gutterWidth: 40, padding: 10, advance: 7 })).toBe(
      MIN_COLUMNS
    );
    expect(codeColumns({ viewportWidth: 400, gutterWidth: 40, padding: 10, advance: 0 })).toBe(
      MIN_COLUMNS
    );
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
