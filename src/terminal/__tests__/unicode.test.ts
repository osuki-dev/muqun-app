// Wide characters (CJK / emoji), combining marks, and wide-glyph line wrapping.
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/parser-edge-cases.test.ts, xterm-compat.test.ts),
// MIT License, Copyright (c) 2026 Rahul Pandita. Rewritten against our
// TerminalEmulator API and cell model.
import { describe, expect, test } from 'bun:test';

import {
  displayWidth,
  graphemeWidth,
  substituteMissingGlyphs,
  substituteRenderedGrapheme,
} from '@/terminal/unicode';

import { emulator, lineText, textOf } from './helpers';

describe('wide characters occupy two cells', () => {
  test('a CJK glyph fills its cell and a zero-width continuation cell', () => {
    const term = emulator(10, 2);
    term.write('你A');
    const cells = term.frame().lines[0].cells;
    expect(cells[0]).toMatchObject({ text: '你', width: 2 });
    expect(cells[1].width).toBe(0); // continuation of the wide glyph
    expect(cells[2]).toMatchObject({ text: 'A', width: 1 });
  });

  test('cursor advances by two columns after a wide glyph', () => {
    const term = emulator(10, 2);
    term.write('你');
    expect(term.frame().cursor.column).toBe(2);
  });

  test('an emoji is treated as a two-column glyph', () => {
    const term = emulator(10, 2);
    term.write('🙂X');
    const cells = term.frame().lines[0].cells;
    expect(cells[0].width).toBe(2);
    expect(cells[2].text).toBe('X');
  });
});

describe('wide-glyph wrapping at the right edge', () => {
  test('a wide glyph that would straddle the margin wraps to the next row', () => {
    const term = emulator(3, 3);
    term.write('A你好');
    expect(textOf(term)).toBe('A你\n好');
  });

  test('two wide glyphs fill an even-width row and wrap cleanly', () => {
    const term = emulator(4, 3);
    term.write('你好世');
    expect(lineText(term.frame(), 0)).toBe('你好');
    expect(lineText(term.frame(), 1)).toBe('世');
  });
});

describe('zero-width combining marks', () => {
  test('a combining accent attaches to the preceding glyph rather than a new cell', () => {
    const term = emulator(10, 2);
    term.write('é'); // e + combining acute
    const cells = term.frame().lines[0].cells;
    expect(cells[0].width).toBe(1);
    expect(cells[0].text).toBe('é');
    expect(term.frame().cursor.column).toBe(1);
  });
});

describe('round-tripping unicode text', () => {
  test('mixed ASCII, CJK, and a ZWJ emoji survive a snapshot', () => {
    const term = emulator(20, 2);
    term.write('A你B é 👨‍💻');
    expect(textOf(term)).toBe('A你B é 👨‍💻');
  });
});

/**
 * The dingbats block is the one an agent draws from constantly -- status ticks,
 * bullets, spinners -- and every one of them is a text-presentation character
 * that terminals give a single column. Scoring them two put every cell after
 * them on the row one column away from where the gateway had laid it out.
 */
describe('dingbats are one column, emoji are two', () => {
  const columnsOf = (input: string) => {
    const term = emulator(20, 2);
    term.write(input);
    return term.frame().cursor.column;
  };

  test.each([
    ['✓', 'check mark'],
    ['✗', 'ballot x'],
    ['✳', 'eight-spoked asterisk'],
    ['❯', 'heavy angle quotation mark'],
    ['✔', 'heavy check mark (substituted to U+2713)'],
    ['✻', 'teardrop asterisk (substituted to U+2733)'],
    ['⚙', 'gear'],
    ['⚠', 'warning sign'],
  ])('%s (%s) takes one column', (character) => {
    expect(graphemeWidth(character)).toBe(1);
    expect(columnsOf(character)).toBe(1);
  });

  test.each([
    ['✅', 'white heavy check mark'],
    ['❌', 'cross mark'],
    ['✨', 'sparkles'],
    ['⚡', 'high voltage'],
    ['❗', 'exclamation mark'],
  ])('%s (%s) takes two columns', (character) => {
    expect(graphemeWidth(character)).toBe(2);
    expect(columnsOf(character)).toBe(2);
  });

  test('a status line of ticks lands on the same columns the agent wrote it at', () => {
    // The regression in one row: three ticks and three words. If a tick is
    // scored two columns the words walk right and the row no longer matches the
    // pane the gateway rendered.
    const term = emulator(30, 2);
    term.write('✓ ok ✗ no ✳ hm');
    const runs = term.frame().lines[0].runs;
    expect(runs[0].startColumn).toBe(0);
    expect(term.frame().cursor.column).toBe('✓ ok ✗ no ✳ hm'.length);
  });

  test('a substituted glyph keeps the width of the character it replaces', () => {
    for (const [missing, substitute] of [
      ['✔', '✓'],
      ['✻', '✳'],
      ['⏵', '▶'],
      ['⏺', '●'],
      ['⎿', '└'],
      ['※', '*'],
      ['◻', '□'],
    ]) {
      expect(graphemeWidth(substituteMissingGlyphs(missing))).toBe(graphemeWidth(missing));
      expect(graphemeWidth(substitute)).toBe(graphemeWidth(missing));
      // The per-grapheme form the renderer now uses agrees with the whole-string
      // one. That agreement is what lets the substitution move to draw time
      // without moving a cell -- and what lets the clipboard keep the original.
      expect(substituteRenderedGrapheme(missing)).toBe(substitute);
      expect(graphemeWidth(substituteRenderedGrapheme(missing))).toBe(graphemeWidth(missing));
    }
  });

  test('every other grapheme is drawn exactly as it was printed', () => {
    for (const grapheme of ['a', '✓', '中', '🙂', '└', ' ', '']) {
      expect(substituteRenderedGrapheme(grapheme)).toBe(grapheme);
    }
  });
});

describe('CJK stays two columns', () => {
  test.each(['中', '、', '「', '！', 'あ', '가'])('%s takes two columns', (character) => {
    expect(graphemeWidth(character)).toBe(2);
  });

  test('a CJK and Latin row measures the same width the gateway laid out', () => {
    // The mixed fixture above: 4 wide + 6 narrow + 1 space + 3 wide.
    expect(displayWidth('条治理、Files 三合一')).toBe(4 * 2 + 5 + 1 + 3 * 2);
  });
});
