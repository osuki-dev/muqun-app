import { describe, expect, test } from 'bun:test';

import {
  MAX_LINE_COLUMNS,
  clampLine,
  gutterDigits,
  indexTextLines,
  lineContentWidth,
} from '../text-preview';

describe('indexTextLines', () => {
  test('an empty file has no lines at all', () => {
    expect(indexTextLines('')).toEqual({ lines: [], longest: 0 });
  });

  test('a file that ends in a newline has no phantom last line', () => {
    expect(indexTextLines('alpha\nbeta\n').lines).toEqual(['alpha', 'beta']);
  });

  test('a file with no trailing newline keeps its last line', () => {
    expect(indexTextLines('alpha\nbeta').lines).toEqual(['alpha', 'beta']);
  });

  test('a blank line before the end is a line; the terminator is not', () => {
    expect(indexTextLines('alpha\n\n').lines).toEqual(['alpha', '']);
  });

  test('a file of one newline is one empty line', () => {
    expect(indexTextLines('\n').lines).toEqual(['']);
  });

  test('CRLF terminators leave no carriage return in the line', () => {
    const index = indexTextLines('alpha\r\nbeta\r\n');
    expect(index.lines).toEqual(['alpha', 'beta']);
    expect(index.longest).toBe(5);
  });

  test('a lone carriage return inside a line is left alone', () => {
    // Only the last character is a terminator's other half. A `\r` in the
    // middle of a line is content, whatever produced it.
    expect(indexTextLines('al\rpha\n').lines).toEqual(['al\rpha']);
  });

  test('the whole file can be one line', () => {
    const index = indexTextLines('x'.repeat(900_000));
    expect(index.lines).toHaveLength(1);
    expect(index.longest).toBe(900_000);
  });

  test('longest is the widest line, not the last', () => {
    expect(indexTextLines('a\nbbbb\ncc').longest).toBe(4);
  });

  test('a file of blank lines indexes them all', () => {
    expect(indexTextLines('\n\n\n').lines).toEqual(['', '', '']);
  });
});

describe('clampLine', () => {
  test('an ordinary line is handed over whole', () => {
    expect(clampLine('const answer = 42;')).toBe('const answer = 42;');
  });

  test('a minified line is cut and marked', () => {
    const clamped = clampLine('x'.repeat(MAX_LINE_COLUMNS + 500));
    expect(clamped).toHaveLength(MAX_LINE_COLUMNS + 1);
    expect(clamped.endsWith('…')).toBe(true);
  });

  test('a line exactly at the clamp is not marked', () => {
    const line = 'x'.repeat(MAX_LINE_COLUMNS);
    expect(clampLine(line)).toBe(line);
  });
});

describe('gutterDigits', () => {
  test('a short file still gets two columns, so the gutter does not resize', () => {
    expect(gutterDigits(0)).toBe(2);
    expect(gutterDigits(9)).toBe(2);
  });

  test('the widest line number decides', () => {
    expect(gutterDigits(100)).toBe(3);
    expect(gutterDigits(4_000)).toBe(4);
    expect(gutterDigits(120_000)).toBe(6);
  });
});

describe('lineContentWidth', () => {
  const base = { advance: 7, gutter: 50, padding: 10, viewport: 390 };

  test('a narrow file is exactly the viewport, so nothing scrolls sideways', () => {
    expect(lineContentWidth({ ...base, longest: 20 })).toBe(390);
  });

  test('a wide file is the longest line, with two cells of slack', () => {
    expect(lineContentWidth({ ...base, longest: 100 })).toBe(50 + 102 * 7 + 20);
  });

  test('a minified line is clamped the same way a row is', () => {
    const clamped = lineContentWidth({ ...base, longest: 900_000 });
    expect(clamped).toBe(lineContentWidth({ ...base, longest: MAX_LINE_COLUMNS }));
    expect(clamped).toBe(50 + (MAX_LINE_COLUMNS + 2) * 7 + 20);
  });

  test('the clamp is honoured when the caller narrows it', () => {
    expect(lineContentWidth({ ...base, longest: 5_000, columns: 200 })).toBe(50 + 202 * 7 + 20);
  });
});
