// Flat snapshot fast path (card #572) -- eligibility and equivalence.
//
// The fast path is only allowed to exist because it is indistinguishable from
// the full emulator, so every case here parses the same input twice, once each
// way, and compares the whole frame: cells, runs, styles, cursor and title.
// `setTerminalFullEmulation` is the only hook the tests need; the fast path has
// no other test surface.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_TERMINAL_THEME } from '@/terminal/palette';
import {
  parseTerminalSnapshot,
  setTerminalFullEmulation,
  snapshotQualifiesForFlatPath,
} from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';
import { codePointWidth, isStandaloneCodeUnit, splitGraphemes } from '@/terminal/unicode';
import { CSI, ESC } from './helpers';

// Minimal shim for the two Bun APIs the recorded-pane case needs, matching how
// scripts/ declare theirs; the project has no @types/bun.
declare const Bun: {
  Glob: new (pattern: string) => { scanSync(options: { cwd: string }): Iterable<string> };
  file(path: string): { text(): Promise<string> };
};

function fullEmulationFrame(input: string): TerminalFrame {
  setTerminalFullEmulation(true);
  try {
    return parseTerminalSnapshot(input);
  } finally {
    setTerminalFullEmulation(false);
  }
}

function expectSamePath(input: string): void {
  expect(parseTerminalSnapshot(input)).toEqual(fullEmulationFrame(input));
}

// Synthetic panes, shaped after what the five real fixtures actually contain:
// SGR that runs past a line end, resets at both ends of a line, 256-colour and
// truecolor side by side, ASCII/CJK mixes, a line as wide as the widest real
// pane (243 columns), and a single line with no trailing newline.
const SYNTHETIC_PANES: readonly (readonly [string, string])[] = [
  ['plain ascii lines', 'alpha\nbeta\ngamma\n'],
  ['crlf line ends', `${CSI}32mok${CSI}0m\r\nsecond line\r\n`],
  ['sgr continues across lines', `${CSI}1;38;5;33mheader\nstill styled\n${CSI}0mplain\n`],
  ['reset at both ends of a line', `${CSI}0m${CSI}31mred line${CSI}0m\n${CSI}0mnext${CSI}0m\n`],
  [
    '256-colour and truecolor mixed',
    `${CSI}38;5;196mA${CSI}48;2;12;34;56mB${CSI}38:2::21:42:63mC${CSI}0m\n${CSI}48;5;21mD${CSI}0m\n`,
  ],
  [
    'ascii and CJK mixed',
    `path/to/file.ts ${CSI}36m你好世界${CSI}0m ok\n纯中文的一行，带标点。\nplain ascii row\n`,
  ],
  ['widest line fills the grid exactly', `${'x'.repeat(243)}\nshort\n`],
  ['wide glyph ends the widest line', `${'x'.repeat(241)}界\nshort\n`],
  [
    'single line, no trailing newline',
    `${CSI}38;5;8m(${CSI}0m${CSI}1mesc${CSI}0m${CSI}38;5;4m)${CSI}0m `,
  ],
  ['empty input', ''],
  ['blank lines and trailing blanks', '\n\nvalue\n\n\n'],
  ['combining marks and emoji clusters', `café ${CSI}33m👨‍💻${CSI}0m 🇨🇳 ℹ️ done\nplain\n`],
];

describe('flat fast path equivalence', () => {
  test.each(SYNTHETIC_PANES)('%s', (_name, input) => {
    expect(snapshotQualifiesForFlatPath(input)).toBe(true);
    expectSamePath(input);
  });
});

// Anything the flat model does not describe has to reach the emulator, because
// the emulator is the only thing that moves a cursor, erases or scrolls.
const EMULATOR_ONLY: readonly (readonly [string, string])[] = [
  ['tab', 'a\tb\n'],
  ['bare carriage return', 'progress 10%\rprogress 90%\n'],
  ['backspace', 'ab\bc\n'],
  ['delete', 'ab\x7fc\n'],
  ['cursor home', `${CSI}Hoverwritten\n`],
  ['erase display', `${CSI}2Jcleared\n`],
  ['erase line', `text${CSI}K\n`],
  ['cursor forward', `a${CSI}5Cb\n`],
  ['private mode', `${CSI}?25lhidden cursor\n`],
  ['alternate buffer', `${CSI}?1049halt\n`],
  ['OSC title', `${ESC}]0;pane title\x07body\n`],
  ['OSC 8 hyperlink', `${ESC}]8;;https://example.com\x07link${ESC}]8;;\x07\n`],
  ['bare ESC sequence', `${ESC}7saved\n`],
  ['truncated CSI at end of input', `text${CSI}38;5`],
  ['non-SGR CSI with SGR-looking parameters', `${CSI}1;5H`],
  ['SGR with an intermediate byte', `${CSI}0 m`],
];

describe('flat fast path fallback', () => {
  test.each(EMULATOR_ONLY)('%s falls back to the emulator', (_name, input) => {
    expect(snapshotQualifiesForFlatPath(input)).toBe(false);
    expectSamePath(input);
  });

  test('a pane wider than the column cap falls back', () => {
    const input = `${'y'.repeat(400)}\n`;
    expect(snapshotQualifiesForFlatPath(input)).toBe(true);
    expectSamePath(input);
  });

  test.each([2000, 2001])('a pane of %s lines matches either way', (lines) => {
    const input = Array.from({ length: lines }, (_, row) => `${CSI}36mrow ${row}${CSI}0m`).join(
      '\n'
    );
    expectSamePath(input);
  });
});

// A supplied width is the pane's own, reported by the gateway on every read --
// see terminal-core.ts's `parseTerminalSnapshot`. Passing it must decide the
// grid outright rather than merely seeding the inference, both below and above
// the old inference cap.
describe('a supplied width decides the grid', () => {
  test('a supplied width decides the grid, not the widest line', () => {
    // A short read must not narrow the grid: that is what reflows a pane when
    // nothing about it changed.
    const frame = parseTerminalSnapshot('hi\n', DEFAULT_TERMINAL_THEME, 357);
    expect(frame.columns).toBe(357);
  });

  test('a supplied width beats the inference cap', () => {
    // 320 is a fallback clamp for when nobody knows. A pane that reports 357 is
    // not a guess to be clamped.
    const wide = 'x'.repeat(357);
    const frame = parseTerminalSnapshot(`${wide}\n`, DEFAULT_TERMINAL_THEME, 357);
    expect(frame.columns).toBe(357);
    expect(frame.lines[0].cells.length).toBeLessThanOrEqual(357);
  });

  test('without a supplied width it still measures', () => {
    // Demo mode and gateways that do not report a width.
    const frame = parseTerminalSnapshot('hi\n');
    expect(frame.columns).toBe(40); // MIN_SNAPSHOT_COLUMNS
  });

  test('a width narrower than the widest line still falls back to the emulator', () => {
    // The guard's whole job is bailing to the emulator whenever the grid the
    // flat path would build is too narrow for the widest line it scanned --
    // otherwise a caller-supplied width smaller than the real content would
    // silently misrender instead of wrapping. Comparing against the
    // forced-emulator path (rather than just checking `frame.columns`) pins
    // that the answer is the *reference* answer, not merely some frame.
    const input = `${'x'.repeat(50)}\n`;
    const narrow = 10;
    setTerminalFullEmulation(true);
    let reference: TerminalFrame;
    try {
      reference = parseTerminalSnapshot(input, DEFAULT_TERMINAL_THEME, narrow);
    } finally {
      setTerminalFullEmulation(false);
    }
    const frame = parseTerminalSnapshot(input, DEFAULT_TERMINAL_THEME, narrow);
    expect(frame).toEqual(reference);
    expect(frame.columns).toBe(narrow);
    expect(frame.rows).toBeGreaterThan(1); // the 50-wide line actually wrapped
  });

  test('a pathological supplied width does not grow the grid unbounded', () => {
    // A width this large only reaches the parser if the gateway is corrupt or
    // compromised, but nothing in the flat path's own scan rejects it: a
    // two-character line easily satisfies `scan.widest > columns`. Without a
    // ceiling, TerminalGrid allocates rows * columns words -- unbounded off a
    // single wire value. It must come back clamped, not merely "not crash".
    const frame = parseTerminalSnapshot('hi\n', DEFAULT_TERMINAL_THEME, 2_000_000);
    expect(frame.columns).toBe(512); // MAX_GRID_COLUMNS
  });
});

// The fast path lays out `isStandaloneCodeUnit` text without segmenting it, so
// the whitelist has to be exactly what its name claims: no unit may join its
// neighbour into one cluster, and each unit's width must be its cluster's.
describe('standalone code unit whitelist', () => {
  test('every whitelisted unit is its own grapheme cluster', () => {
    let units = '';
    for (let unit = 0x20; unit <= 0xffff; unit += 1) {
      if (isStandaloneCodeUnit(unit)) units += String.fromCharCode(unit);
    }
    expect(units.length).toBeGreaterThan(40000);
    expect(splitGraphemes(units)).toHaveLength(units.length);
  });

  test('no whitelisted unit is zero-width', () => {
    const zeroWidth: number[] = [];
    for (let unit = 0x20; unit <= 0xffff; unit += 1) {
      if (isStandaloneCodeUnit(unit) && codePointWidth(unit) === 0) zeroWidth.push(unit);
    }
    expect(zeroWidth).toHaveLength(0);
  });
});

// Real panes captured from the gateway. They contain private output, so they
// are never committed: point MUQUN_TERMINAL_FIXTURES at a directory holding
// `pane-*.json` gateway read responses to run these, otherwise it is skipped.
describe('recorded pane snapshots', () => {
  const directory = process.env.MUQUN_TERMINAL_FIXTURES;
  const names = directory
    ? [...new Bun.Glob('pane-*.json').scanSync({ cwd: directory })].sort()
    : [];

  if (names.length === 0) {
    test.skip('set MUQUN_TERMINAL_FIXTURES to compare recorded panes', () => {});
  } else {
    test.each(names)('%s parses identically on both paths', async (name: string) => {
      const payload = JSON.parse(await Bun.file(`${directory}/${name}`).text()) as {
        result?: { read?: { text?: unknown } };
      };
      const text = payload.result?.read?.text;
      expect(typeof text).toBe('string');
      expect(snapshotQualifiesForFlatPath(text as string)).toBe(true);
      expectSamePath(text as string);
    });
  }
});
