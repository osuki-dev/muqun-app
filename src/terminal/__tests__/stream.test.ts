// The emulator as a stream sink: a byte stream cut anywhere -- inside a CSI,
// an OSC, a surrogate pair -- must leave the same frame as the uncut text,
// and `parseTerminalSnapshot`, which is one write and a flush, must be the
// frame it always was.
import { describe, expect, test } from 'bun:test';

import {
  parseTerminalSnapshot,
  setTerminalFullEmulation,
  TerminalEmulator,
} from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';

import goldens from './fixtures/snapshot-goldens.json';
import { frameDigest } from './frame-digest';
import { CSI, ESC, cursorOf, emulator, textOf } from './helpers';
import { STREAM_CORPUS } from './stream-corpus';

function fresh(): TerminalEmulator {
  return new TerminalEmulator({ columns: 20, rows: 6, scrollback: 10 });
}

function singleShot(input: string): TerminalFrame {
  const term = fresh();
  term.write(input);
  term.flush();
  return term.frame();
}

function chunked(input: string, boundaries: number[]): TerminalFrame {
  const term = fresh();
  let start = 0;
  for (const boundary of boundaries) {
    term.write(input.slice(start, boundary));
    start = boundary;
  }
  term.write(input.slice(start));
  term.flush();
  return term.frame();
}

describe('chunk-boundary invariance', () => {
  test.each(STREAM_CORPUS)('%s: every single cut', (_name, input) => {
    const reference = singleShot(input);
    for (let cut = 0; cut <= input.length; cut += 1) {
      expect(chunked(input, [cut])).toEqual(reference);
    }
  });

  test.each(STREAM_CORPUS)('%s: one code unit at a time', (_name, input) => {
    const reference = singleShot(input);
    const cuts = Array.from({ length: input.length }, (_, index) => index + 1);
    expect(chunked(input, cuts)).toEqual(reference);
  });

  test.each(STREAM_CORPUS)('%s: three-way cuts through every sequence', (_name, input) => {
    const reference = singleShot(input);
    for (let first = 0; first < input.length; first += 1) {
      if (input.charCodeAt(first) !== 0x1b) continue;
      for (let second = first; second <= Math.min(input.length, first + 12); second += 1) {
        expect(chunked(input, [first, second])).toEqual(reference);
      }
    }
  });

  test('a sequence split across writes is not visible in between', () => {
    const term = emulator(20, 2);
    term.write(`a${CSI}3`);
    expect(textOf(term)).toBe('a');
    term.write('1m');
    expect(textOf(term)).toBe('a');
    term.write('b');
    expect(term.frame().lines[0].cells[1].style.foreground).not.toBeNull();
  });

  test('an OSC waits for its terminator across writes', () => {
    const term = emulator(20, 2);
    term.write(`${ESC}]0;half`);
    term.write(' a title\x07shown');
    const frame = term.frame();
    expect(frame.title).toBe('half a title');
    expect(textOf(term)).toBe('shown');
  });

  test('an OSC ending in ESC waits for the backslash of ST', () => {
    const term = emulator(20, 2);
    term.write(`${ESC}]2;name${ESC}`);
    expect(term.frame().title).toBeNull();
    term.write('\\after');
    expect(term.frame().title).toBe('name');
    expect(textOf(term)).toBe('after');
  });

  test('a surrogate pair split across writes is one cell', () => {
    const term = emulator(20, 2);
    term.write('a\ud83d');
    expect(textOf(term)).toBe('a');
    term.write('\ude00b');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['a', '😀', 'b']);
  });

  test('flush ends the stream the way a single write used to', () => {
    const term = emulator(20, 2);
    term.write(`keep${ESC}]0;partial`);
    expect(term.frame().title).toBeNull();
    term.flush();
    expect(term.frame().title).toBe('partial');
    expect(textOf(term)).toBe('keep');
  });

  test('a runaway string is given up on past the limit rather than held forever', () => {
    // 64 KiB is the cap (`STRING_SEQUENCE_LIMIT`): the string is abandoned
    // there -- not acted on, so the title stays unset -- and what follows the
    // cap is ordinary input. `hostile-output.test.ts` has the rest of the cases.
    const term = emulator(20, 2);
    term.write(`${ESC}]0;`);
    term.write('x'.repeat(70 * 1024));
    term.write('visible');
    expect(term.frame().title).toBeNull();
    expect(textOf(term).endsWith('visible')).toBe(true);
  });

  test('reset drops a held sequence', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}3`);
    term.reset();
    term.write('1mX');
    expect(textOf(term)).toBe('1mX');
  });
});

describe('parseTerminalSnapshot is unchanged', () => {
  // Recorded from the terminal-core before `write` learned to hold a tail
  // (scripts/__gen-goldens, see fixtures/snapshot-goldens.json). Every corpus
  // entry, on the flat path, the forced-slow path, with a supplied width, and
  // through a bare emulator.
  test.each(STREAM_CORPUS)('%s', (name, input) => {
    const recorded = goldens as Record<string, string>;
    expect(frameDigest(parseTerminalSnapshot(input))).toBe(recorded[`snapshot:${name}`]);
    expect(frameDigest(parseTerminalSnapshot(input, undefined, 60))).toBe(
      recorded[`snapshot@60:${name}`]
    );
    setTerminalFullEmulation(true);
    try {
      expect(frameDigest(parseTerminalSnapshot(input))).toBe(recorded[`snapshot-full:${name}`]);
    } finally {
      setTerminalFullEmulation(false);
    }
    expect(frameDigest(singleShot(input))).toBe(recorded[`emulator:${name}`]);
  });

  test('the goldens cover the whole corpus', () => {
    expect(Object.keys(goldens)).toHaveLength(STREAM_CORPUS.length * 4);
  });
});

describe('clusters cut by a chunk boundary', () => {
  test('a ZWJ sequence split before its second emoji is one cell', () => {
    const term = emulator(20, 2);
    term.write('👨‍');
    term.write('💻!');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['👨‍💻', '!']);
    expect(cursorOf(term.frame()).column).toBe(3);
  });

  test('a flag split between its regional indicators is one cell', () => {
    const term = emulator(20, 2);
    term.write('🇨');
    term.write('🇳x');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['🇨🇳', 'x']);
  });

  test('a skin tone arriving after its base joins it', () => {
    const term = emulator(20, 2);
    term.write('👍');
    term.write('🏽');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['👍🏽']);
    expect(cursorOf(term.frame()).column).toBe(2);
  });

  test('a control or escape between the halves keeps them apart, as one write would', () => {
    const term = emulator(20, 2);
    term.write('🇨\x1b[0m');
    term.write('🇳');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['🇨', '🇳']);
  });

  test('a chunk starting with a combining mark still attaches to the cell before it', () => {
    const term = emulator(20, 2);
    term.write('e');
    term.write('́x');
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text)).toEqual(['e\u0301', 'x']);
  });
});
