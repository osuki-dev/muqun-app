// Cursor movement + boundary clamping.
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/xterm-compat.test.ts, parser-edge-cases.test.ts),
// MIT License, Copyright (c) 2026 Rahul Pandita. Their VTParser/BufferSet API is
// rewritten here as assertions against our TerminalEmulator/TerminalFrame API,
// and expected values follow real xterm behaviour where the two disagree.
import { describe, expect, test } from 'bun:test';
import { CSI, cursorOf, emulator, lineText } from './helpers';

describe('cursor absolute positioning (CUP / HVP)', () => {
  test('CUP moves to 1-based row;col', () => {
    const term = emulator(20, 10);
    term.write(`${CSI}3;5HX`);
    const frame = term.frame();
    // Row 3, col 5 (1-based) -> row 2, col 4 (0-based); the glyph lands there.
    expect(lineText(frame, 2)[4]).toBe('X');
  });

  test('CUP with no params homes to top-left', () => {
    const term = emulator(20, 10);
    term.write(`${CSI}5;5H${CSI}HX`);
    expect(lineText(term.frame(), 0)[0]).toBe('X');
  });

  test('HVP (f) is an alias for CUP', () => {
    const term = emulator(20, 10);
    term.write(`${CSI}4;2fX`);
    expect(lineText(term.frame(), 3)[1]).toBe('X');
  });

  test('CUP past the screen clamps to the last row and column', () => {
    const term = emulator(10, 5);
    term.write(`${CSI}100;100H`);
    expect(cursorOf(term.frame())).toMatchObject({ row: 4, column: 9 });
  });
});

describe('relative cursor movement', () => {
  test('CUU / CUD move up and down and default to 1', () => {
    const term = emulator(10, 8);
    term.write(`${CSI}5;1H${CSI}2A`); // to row 4, up 2 -> row 2
    expect(cursorOf(term.frame()).row).toBe(2);
    term.write(`${CSI}B`); // down 1 (default) -> row 3
    expect(cursorOf(term.frame()).row).toBe(3);
  });

  test('CUF / CUB move forward and back', () => {
    const term = emulator(10, 3);
    term.write(`${CSI}5C`); // forward 5
    expect(cursorOf(term.frame()).column).toBe(5);
    term.write(`${CSI}2D`); // back 2
    expect(cursorOf(term.frame()).column).toBe(3);
  });

  test('CHA (G) and VPA (d) set one absolute axis', () => {
    const term = emulator(20, 10);
    term.write(`${CSI}7G${CSI}4d`); // column 7 (1-based), row 4 (1-based)
    expect(cursorOf(term.frame())).toMatchObject({ column: 6, row: 3 });
  });
});

describe('cursor boundary clamping', () => {
  test('CUU at the top row stays at the top', () => {
    const term = emulator(10, 5);
    term.write(`${CSI}10A`);
    expect(cursorOf(term.frame()).row).toBe(0);
  });

  test('CUB at column 0 stays at column 0', () => {
    const term = emulator(10, 5);
    term.write(`${CSI}10D`);
    expect(cursorOf(term.frame()).column).toBe(0);
  });

  test('CUD at the bottom row stays at the bottom', () => {
    const term = emulator(10, 5);
    term.write(`${CSI}5;1H${CSI}10B`);
    expect(cursorOf(term.frame()).row).toBe(4);
  });

  test('CUF at the right margin stays at the last column', () => {
    const term = emulator(10, 5);
    term.write(`${CSI}20C`);
    expect(cursorOf(term.frame()).column).toBe(9);
  });
});

describe('deferred wrap (VT100 pending-wrap semantics)', () => {
  test('writing exactly `columns` glyphs stays on the same row until the next glyph', () => {
    const term = emulator(4, 3);
    term.write('ABCD');
    const filled = term.frame();
    expect(filled.rows).toBe(1);
    expect(cursorOf(filled).column).toBe(3);
    term.write('E');
    const wrapped = term.frame();
    expect(lineText(wrapped, 0)).toBe('ABCD');
    expect(lineText(wrapped, 1)).toBe('E');
  });

  test('writing columns-1 glyphs does not wrap', () => {
    const term = emulator(4, 3);
    term.write('ABCd');
    term.write(`${CSI}2D`); // a cursor move clears the pending wrap
    expect(cursorOf(term.frame()).row).toBe(0);
  });
});
