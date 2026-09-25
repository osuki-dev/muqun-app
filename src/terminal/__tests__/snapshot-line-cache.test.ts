// `SnapshotLineCache` -- a row reused from an earlier parse is indistinguishable
// from the row a fresh parse builds. Every case compares the cached frame with
// the uncached one for the same input, across sequences of snapshots shaped
// like the refreshes a live pane produces.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_TERMINAL_THEME, type TerminalTheme } from '@/terminal/palette';
import {
  createSnapshotLineCache,
  parseTerminalSnapshot,
  terminalFrameLinks,
} from '@/terminal/terminal-core';
import { CSI } from './helpers';
import { STREAM_CORPUS } from './stream-corpus';

type Parse = { theme?: TerminalTheme; columns?: number; rows?: number };

function expectSequence(inputs: readonly string[], options: Parse = {}): void {
  const cache = createSnapshotLineCache();
  for (const input of inputs) {
    const theme = options.theme ?? DEFAULT_TERMINAL_THEME;
    const cached = parseTerminalSnapshot(input, theme, options.columns, options.rows, cache);
    expect(cached).toEqual(parseTerminalSnapshot(input, theme, options.columns, options.rows));
  }
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸'];
const history = Array.from(
  { length: 40 },
  (_, index) => `line ${index} ${CSI}3${index % 8}mcolour${CSI}0m`
);

describe('snapshot line cache equivalence', () => {
  test.each(STREAM_CORPUS.map(([name, input]) => [name, input] as const))(
    '%s parses the same with a cache',
    (_name: string, input: string) => {
      expectSequence([input, input]);
      expectSequence([input], { columns: 60 });
      expectSequence([input], { columns: 60, rows: 30 });
    }
  );

  test('a spinner line changing under unchanged history', () => {
    expectSequence(
      SPINNER.map((glyph) => `${history.join('\n')}\n${CSI}36m${glyph}${CSI}0m working`),
      { columns: 80 }
    );
  });

  test('a stream pushing rows off the top', () => {
    const frames = Array.from({ length: 10 }, (_, offset) =>
      history.slice(offset, offset + 30).join('\n')
    );
    expectSequence(frames, { columns: 80, rows: 32 });
  });

  test('an unterminated style above changes the rows below it', () => {
    // The lower rows' text never changes; only the style running into them does.
    expectSequence([
      `head\n${CSI}31mred starts\nbelow\nand below\n`,
      `head\n${CSI}32mgreen starts\nbelow\nand below\n`,
      `head\nplain now\nbelow\nand below\n`,
      `head\n${CSI}31mred starts\nbelow\nand below\n`,
    ]);
  });

  test('the same row twice in one snapshot, one styled and one not', () => {
    expectSequence([`same\n${CSI}1mbold\nsame\n${CSI}0msame\n`]);
  });

  test('wide and combining text', () => {
    expectSequence([
      `路径 ${CSI}36m你好世界${CSI}0m ok\né 👩‍💻 done\n`,
      `路径 ${CSI}36m你好世界${CSI}0m ok\né 👩‍💻 done\nmore\n`,
    ]);
  });

  test('a width or theme change is not served stale rows', () => {
    const cache = createSnapshotLineCache();
    const input = `${CSI}31mred${CSI}0m\nplain\n`;
    const other: TerminalTheme = {
      ...DEFAULT_TERMINAL_THEME,
      ansi: DEFAULT_TERMINAL_THEME.ansi.map((colour, index) => (index === 1 ? '#123456' : colour)),
    };
    for (const [theme, columns] of [
      [DEFAULT_TERMINAL_THEME, 40],
      [DEFAULT_TERMINAL_THEME, 50],
      [other, 50],
      [DEFAULT_TERMINAL_THEME, 40],
    ] as const) {
      expect(parseTerminalSnapshot(input, theme, columns, undefined, cache)).toEqual(
        parseTerminalSnapshot(input, theme, columns)
      );
    }
  });

  test('a snapshot that leaves the flat path still parses exactly', () => {
    expectSequence(['one\ntwo\n', 'one\rONE\ntwo\n', 'one\ntwo\n']);
  });
});

describe('snapshot line cache reuse', () => {
  test('rows that did not change are the same objects', () => {
    const cache = createSnapshotLineCache();
    const before = parseTerminalSnapshot(`a\nb\n${SPINNER[0]}`, undefined, 40, undefined, cache);
    const after = parseTerminalSnapshot(`a\nb\n${SPINNER[1]}`, undefined, 40, undefined, cache);
    expect(after.lines[0]).toBe(before.lines[0]);
    expect(after.lines[1]).toBe(before.lines[1]);
    expect(after.lines[2]).not.toBe(before.lines[2]);
  });

  test('a row pushed up the pane is still reused', () => {
    const cache = createSnapshotLineCache();
    const before = parseTerminalSnapshot('a\nb\nc', undefined, 40, undefined, cache);
    const after = parseTerminalSnapshot('b\nc\nd', undefined, 40, undefined, cache);
    expect(after.lines[0]).toBe(before.lines[1]);
    expect(after.lines[1]).toBe(before.lines[2]);
  });

  test('entries do not outlive the parse after the one that used them', () => {
    const cache = createSnapshotLineCache();
    const first = parseTerminalSnapshot('kept\ngone', undefined, 40, undefined, cache);
    parseTerminalSnapshot('kept\nx', undefined, 40, undefined, cache);
    parseTerminalSnapshot('kept\ny', undefined, 40, undefined, cache);
    const back = parseTerminalSnapshot('kept\ngone', undefined, 40, undefined, cache);
    expect(back.lines[0]).toBe(first.lines[0]);
    expect(back.lines[1]).not.toBe(first.lines[1]);
    expect(back.lines[1]).toEqual(first.lines[1]);
  });
});

describe('links over reused rows', () => {
  test('a reused row reports its links at the row it now sits on', () => {
    const cache = createSnapshotLineCache();
    const rows = [
      'see https://example.com/a and /tmp/notes.md',
      `${CSI}34mplain${CSI}0m`,
      'open "/Users/me/My File.txt" now',
      'https://example.com/b，后面',
    ];
    const before = parseTerminalSnapshot(rows.join('\n'), undefined, 80, undefined, cache);
    expect(terminalFrameLinks(before)).toEqual(
      terminalFrameLinks(parseTerminalSnapshot(rows.join('\n'), undefined, 80))
    );
    const shiftedInput = ['new top', ...rows].join('\n');
    const shifted = parseTerminalSnapshot(shiftedInput, undefined, 80, undefined, cache);
    expect(shifted.lines[1]).toBe(before.lines[0]);
    expect(terminalFrameLinks(shifted)).toEqual(
      terminalFrameLinks(parseTerminalSnapshot(shiftedInput, undefined, 80))
    );
    expect(terminalFrameLinks(shifted).map((link) => link.row)).toEqual(
      terminalFrameLinks(before).map((link) => link.row + 1)
    );
  });
});
