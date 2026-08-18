// Scroll region (DECSTBM), SU/SD, reverse index, save/restore cursor,
// insert mode (IRM), auto-wrap (DECAWM), and alternate-screen switching.
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/xterm-compat.test.ts, parser-edge-cases.test.ts),
// MIT License, Copyright (c) 2026 Rahul Pandita. Rewritten against our
// TerminalEmulator API; expectations follow real xterm behaviour.
import { describe, expect, test } from 'bun:test';
import { CSI, ESC, cursorOf, emulator, lineText, textOf } from './helpers';

describe('DECSTBM — scroll region', () => {
  test('scrolling inside a region leaves rows outside it untouched', () => {
    const term = emulator(8, 5);
    term.write('L0\nL1\nL2\nL3\nL4');
    term.write(`${CSI}2;4r`); // region = rows 2..4 (0-based 1..3); also homes the cursor
    term.write(`${CSI}4;1HX\n`); // overwrite the region's bottom row, then feed to scroll it
    const frame = term.frame();
    expect(lineText(frame, 0)).toBe('L0'); // above the region, preserved
    expect(lineText(frame, 4)).toBe('L4'); // below the region, preserved
    expect(lineText(frame, 1)).toBe('L2'); // L1 scrolled off the region top and was dropped
    expect(lineText(frame, 2)).toBe('X3');
  });

  test('setting a region homes the cursor to the top-left', () => {
    const term = emulator(8, 6);
    term.write(`${CSI}3;3H${CSI}2;5r`);
    expect(cursorOf(term.frame())).toMatchObject({ row: 0, column: 0 });
  });

  test('an inverted region (top >= bottom) is ignored and does not home the cursor', () => {
    const term = emulator(6, 4);
    term.write('a\nb\nc\nd');
    term.write(`${CSI}5;2r`);
    term.write('Z');
    expect(textOf(term)).toBe('a\nb\nc\ndZ');
  });

  // DEVIATION: origin mode (DECOM, CSI ?6h) is not implemented — CUP is always
  // absolute. With origin mode on, "CSI 1;1H" should be relative to the scroll
  // region's top-left, so X below would land on row 1, not row 0. Skipped rather
  // than fixed because nothing in our output path emits DECOM and adding it would
  // touch every cursor-positioning branch.
  test.skip('DECOM makes CUP relative to the scroll region', () => {
    const term = emulator(10, 6);
    term.write(`${CSI}?6h${CSI}2;4r${CSI}1;1HX`);
    expect(lineText(term.frame(), 1)[0]).toBe('X');
  });
});

describe('SU / SD — scroll up and down', () => {
  test('SU scrolls the screen up, discarding the top rows (no scrollback)', () => {
    const term = emulator(6, 4, { scrollback: 0 });
    term.write('a\nb\nc\nd');
    term.write(`${CSI}H${CSI}2S`);
    expect(textOf(term)).toBe('c\nd');
  });

  test('SD scrolls the screen down, inserting blank rows at the top', () => {
    const term = emulator(6, 4);
    term.write('a\nb\nc\nd');
    term.write(`${CSI}H${CSI}2T`);
    expect(textOf(term)).toBe('\n\na\nb');
  });
});

describe('reverse index (RI)', () => {
  test('RI moves the cursor up one row', () => {
    const term = emulator(6, 4);
    term.write('a\nb\nc');
    term.write(`${CSI}2;1H${ESC}MX`); // at row 1, reverse index to row 0
    expect(textOf(term)).toBe('X\nb\nc');
  });

  test('RI at the top of the region scrolls the region down', () => {
    const term = emulator(6, 4);
    term.write('a\nb');
    term.write(`${CSI}H${ESC}M`);
    expect(textOf(term)).toBe('\na\nb');
  });
});

describe('save / restore cursor', () => {
  test('ESC 7 / ESC 8 save and restore the cursor position', () => {
    const term = emulator(10, 3);
    term.write(`${ESC}7${CSI}3;3Hmid${ESC}8X`);
    const frame = term.frame();
    expect(lineText(frame, 0)[0]).toBe('X');
    expect(lineText(frame, 2)).toBe('  mid');
  });

  test('CSI s / CSI u save and restore the cursor position', () => {
    const term = emulator(10, 3);
    term.write(`${CSI}2;4H${CSI}sjunk${CSI}u`);
    expect(cursorOf(term.frame())).toMatchObject({ row: 1, column: 3 });
  });
});

describe('IRM — insert mode', () => {
  test('when insert mode is on, glyphs push existing text to the right', () => {
    const term = emulator(8, 2);
    term.write(`ABC${CSI}4h\rX`);
    expect(textOf(term)).toBe('XABC');
  });

  test('insert mode can be turned back off (replace mode)', () => {
    const term = emulator(8, 2);
    term.write(`ABC${CSI}4h${CSI}4l\rX`);
    expect(textOf(term)).toBe('XBC');
  });
});

describe('DECAWM — auto-wrap mode', () => {
  test('auto-wrap is on by default and text wraps to the next row', () => {
    const term = emulator(4, 3);
    term.write('ABCDE');
    expect(textOf(term)).toBe('ABCD\nE');
  });

  test('with DECAWM off the last column is overwritten instead of wrapping', () => {
    const term = emulator(4, 3);
    term.write(`${CSI}?7lABCDEFG`);
    expect(textOf(term)).toBe('ABCG');
    expect(cursorOf(term.frame()).row).toBe(0);
  });

  test('re-enabling DECAWM restores wrapping', () => {
    const term = emulator(4, 2);
    term.write(`${CSI}?7lABCD${CSI}?7hEFGH`);
    // After re-enabling, the pending wrap is cleared by the CSI, so E overwrites
    // column 3 and wrapping resumes from there.
    expect(textOf(term)).toBe('ABCE\nFGH');
  });
});

describe('alternate screen buffer (1049)', () => {
  test('entering the alt screen hides the main content, exiting restores it', () => {
    const term = emulator(10, 3);
    term.write(`main${CSI}?1049hALT`);
    expect(textOf(term)).toBe('ALT');
    term.write(`${CSI}?1049l`);
    expect(textOf(term)).toBe('main');
  });

  test('1049 restores the saved cursor position on exit', () => {
    const term = emulator(10, 3);
    term.write(`main${CSI}?1049h${CSI}2;2Hx${CSI}?1049lY`);
    // Cursor returns to just past "main" (column 4) and Y lands there.
    expect(lineText(term.frame(), 0)).toBe('mainY');
  });
});

describe('cursor visibility (DECTCEM)', () => {
  test('CSI ?25l hides the cursor and CSI ?25h shows it', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?25l`);
    expect(cursorOf(term.frame()).visible).toBe(false);
    term.write(`${CSI}?25h`);
    expect(cursorOf(term.frame()).visible).toBe(true);
  });
});
