import { describe, expect, test } from 'bun:test';

import { isNativeWidthLine, keepNativeWidthRows } from '@/terminal/native-width';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';
import type { TerminalFrame, TerminalLine } from '@/terminal/types';
import { displayWidth } from '@/terminal/unicode';

const PANE_COLUMNS = 40;

/** Printed text of a row, blanks the row's cells leave off restored up to `width`. */
function rowText(line: TerminalLine, width = 0): string {
  let text = '';
  for (const cell of line.cells) if (cell.width > 0) text += cell.text === '' ? ' ' : cell.text;
  return text + ' '.repeat(Math.max(0, width - line.cells.length));
}

/** The frame read back as logical lines: wrap chains joined, hard line ends kept. */
function logicalLines(frame: TerminalFrame): string[] {
  const out: string[] = [];
  let current = '';
  for (const line of frame.lines) {
    if (line.wrapsToNext) {
      current += rowText(line, line.wrapsToNext);
      continue;
    }
    out.push((current + rowText(line)).trimEnd());
    current = '';
  }
  if (current !== '') out.push(current.trimEnd());
  return out;
}

const plain = (value: string) => value.replace(/\u001b\[[0-9;:]*m/g, '');

/** Prose wider than the pane, a box-drawn table, a pipe table and CJK, in colour. */
const FIXTURE = [
  '\u001b[1mBuild\u001b[0m finished: the bundle for the release candidate is ready to upload to the store.',
  '┌──────────────┬──────────────────────┬──────────────────────┐',
  '│ \u001b[32mPackage\u001b[0m      │ Version              │ Notes                │',
  '├──────────────┼──────────────────────┼──────────────────────┤',
  '│ skia         │ 3.0.3                │ Graphite on Vulkan   │',
  '└──────────────┴──────────────────────┴──────────────────────┘',
  '| Column one | Column two with padding    | three      |',
  '在手机上查看终端输出时，宽表格应该保持原样并可以横向拖动查看，而普通文字按宽度换行。',
  'short line',
  '',
  '  ⎿  a trailing line that is long enough to wrap past the forty column pane edge',
].join('\n');

function ingest(input: string, maxColumns?: number): TerminalFrame {
  return keepNativeWidthRows(parseTerminalSnapshot(input, undefined, PANE_COLUMNS), maxColumns);
}

describe('isNativeWidthLine', () => {
  test.each<[string, boolean]>([
    ['┌────┬────┐', true],
    ['│ a  │ b  │', true],
    ['▁▂▃▄▅▆▇█ load', true],
    ['⣿⣿⣷⣄ braille art', true],
    ['| a | b |', true],
    ['name | size | modified', true],
    ['================ heading rule', true],
    ['■■■■□□□□ 50%', true],
    ['An ordinary sentence, with commas -- and a dash.', false],
    ['https://example.com/a/very/long/path?query=1&other=2', false],
    ['cat file|grep x', false],
    ['中文的普通段落，不应该被当作表格。', false],
  ])('%p -> %p', (text, expected) => {
    expect(isNativeWidthLine(text)).toBe(expected);
  });
});

describe('keepNativeWidthRows', () => {
  test('the round trip is lossless: every logical line comes back whole', () => {
    const frame = ingest(FIXTURE);
    expect(logicalLines(frame)).toEqual(FIXTURE.split('\n').map((line) => plain(line).trimEnd()));
  });

  test('pictures keep their own width on one row; prose still wraps at the pane', () => {
    const frame = ingest(FIXTURE);
    const widest = Math.max(...FIXTURE.split('\n').map((line) => displayWidth(plain(line))));
    for (const line of frame.lines) {
      const text = rowText(line).trimEnd();
      if (isNativeWidthLine(text)) {
        expect(line.wrapsToNext).toBeUndefined();
      } else {
        expect(line.cells.length).toBeLessThanOrEqual(PANE_COLUMNS);
      }
    }
    // The box and the pipe table are whole rows now, so the frame -- and the
    // pan the canvas measures off it -- is as wide as the widest of them.
    const box = FIXTURE.split('\n')[1];
    expect(frame.lines.some((line) => rowText(line) === box)).toBe(true);
    expect(frame.columns).toBe(Math.max(PANE_COLUMNS, displayWidth(box)));
    expect(frame.columns).toBeLessThanOrEqual(widest);
  });

  test('colour survives the join, on the cells it was printed on', () => {
    const frame = ingest(FIXTURE);
    const header = frame.lines.find((line) => rowText(line).startsWith('│ Package'));
    expect(header).toBeDefined();
    const green = header!.cells[2];
    expect(green.text).toBe('P');
    expect(green.style.foreground).not.toBeNull();
    expect(header!.cells[0].style.foreground).toBeNull();
    // And the signature is the grid's own, so the chunk cache and the scroll
    // anchor see the same row the same way on every refresh.
    expect(
      ingest(FIXTURE).lines.find((line) => rowText(line).startsWith('│ Package'))!.signature
    ).toBe(header!.signature);
  });

  test('a logical line longer than the pane keeps its first rows', () => {
    // The parse used to size its grid one row per line, with no scrollback, so
    // a line that wrapped onto three rows pushed its own first row off the top.
    const prose = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ');
    const frame = parseTerminalSnapshot(prose, undefined, PANE_COLUMNS);
    expect(frame.lines.length).toBeGreaterThan(2);
    expect(logicalLines(frame)).toEqual([prose]);
    const box = '│'.repeat(90);
    expect(logicalLines(parseTerminalSnapshot(box, undefined, PANE_COLUMNS))).toEqual([box]);
  });

  test('a wide glyph at the break keeps its place, and the column it skipped stays out', () => {
    // 39 ASCII columns and then a CJK glyph that cannot fit in the 40th: the
    // emulator leaves the 40th blank and wraps. Joined, nothing moves.
    const line = `${'─'.repeat(39)}表格────`;
    const frame = ingest(line);
    expect(frame.lines).toHaveLength(1);
    expect(rowText(frame.lines[0])).toBe(line);
    expect(logicalLines(frame)).toEqual([line]);
  });

  test('a line wider than the grid cap is left wrapped rather than cut', () => {
    const wide = '│'.repeat(90);
    const frame = ingest(wide, 64);
    expect(frame.lines.length).toBeGreaterThan(1);
    expect(logicalLines(frame)).toEqual([wide]);
  });

  test('nothing to join hands back the same frame', () => {
    const parsed = parseTerminalSnapshot('one\ntwo\nthree', undefined, PANE_COLUMNS);
    expect(keepNativeWidthRows(parsed)).toBe(parsed);
    // Prose that wraps is prose: still the same frame.
    const prose = parseTerminalSnapshot('word '.repeat(30), undefined, PANE_COLUMNS);
    expect(keepNativeWidthRows(prose)).toBe(prose);
  });

  test('the cursor follows the rows a join removed', () => {
    const frame = ingest(`${'─'.repeat(90)}\n$ `);
    expect(frame.lines).toHaveLength(2);
    expect(frame.cursor.row).toBe(1);
  });
});
