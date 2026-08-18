// Erase in Display (ED) / Erase in Line (EL) / Erase Characters (ECH).
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/xterm-compat.test.ts), MIT License,
// Copyright (c) 2026 Rahul Pandita. Expected values follow real xterm:
// erase honours the current SGR background (back-colour erase).
import { describe, expect, test } from 'bun:test';
import { CSI, emulator, ESC, lineText, styleAt } from './helpers';

function fourRows() {
  const term = emulator(10, 4);
  term.write('AAAA\nBBBB\nCCCC\nDDDD');
  return term;
}

describe('ED — erase in display', () => {
  test('ED(0) erases from the cursor to the end of the screen', () => {
    const term = fourRows();
    term.write(`${CSI}2;3H${CSI}0J`); // cursor at row 1, col 2
    const frame = term.frame();
    expect(lineText(frame, 0)).toBe('AAAA');
    expect(lineText(frame, 1)).toBe('BB');
    expect(lineText(frame, 2)).toBe('');
    expect(lineText(frame, 3)).toBe('');
  });

  test('ED(1) erases from the start of the screen to the cursor', () => {
    const term = fourRows();
    term.write(`${CSI}2;3H${CSI}1J`);
    const frame = term.frame();
    expect(lineText(frame, 0)).toBe('');
    expect(lineText(frame, 1).slice(0, 3)).toBe('   '); // cols 0..2 cleared
    expect(lineText(frame, 1)[3]).toBe('B');
    expect(lineText(frame, 2)).toBe('CCCC');
  });

  test('ED(2) clears the whole screen', () => {
    const term = fourRows();
    term.write(`${CSI}2J`);
    const frame = term.frame();
    for (let row = 0; row < 4; row += 1) expect(lineText(frame, row)).toBe('');
  });
});

describe('EL — erase in line', () => {
  test('EL(0) erases from the cursor to the end of the line', () => {
    const term = emulator(10, 2);
    term.write(`ABCDEF${CSI}4G${CSI}0K`); // cursor at col 3
    expect(lineText(term.frame(), 0)).toBe('ABC');
  });

  test('EL(1) erases from the start of the line to the cursor', () => {
    const term = emulator(10, 2);
    term.write(`ABCDEF${CSI}4G${CSI}1K`);
    const text = lineText(term.frame(), 0);
    expect(text.slice(0, 4)).toBe('    '); // cols 0..3 cleared
    expect(text.slice(4)).toBe('EF');
  });

  test('EL(2) erases the whole line', () => {
    const term = emulator(10, 2);
    term.write(`ABCDEF${CSI}2K`);
    expect(lineText(term.frame(), 0)).toBe('');
  });
});

describe('ECH — erase characters', () => {
  test('ECH erases n cells from the cursor without moving it', () => {
    const term = emulator(10, 2);
    term.write(`ABCDEF${CSI}3G${CSI}2X`); // cursor at col 2, erase 2
    const text = lineText(term.frame(), 0);
    expect(text[0]).toBe('A');
    expect(text[1]).toBe('B');
    expect(text.slice(2, 4)).toBe('  ');
    expect(text[4]).toBe('E');
  });
});

describe('back-colour erase', () => {
  test('erase fills cleared cells with the active background colour', () => {
    const term = emulator(6, 2);
    term.write(`${CSI}41m${CSI}2K`);
    const style = styleAt(term.frame(), 0, 0);
    expect(style?.background).not.toBeNull();
  });

  test('a line erased under an active background is not trimmed away as blank', () => {
    const term = emulator(6, 2);
    term.write(`${CSI}44m${CSI}2K`);
    // The coloured blank line must survive frame trimming so the fill renders.
    expect(term.frame().lines[0].cells.length).toBeGreaterThan(0);
  });
});

// The regression fence for card #685. A full-screen program clears with the
// scheme's background active and expects the cleared ground to *be* that
// colour; anything here that answered "default" would put a hole the app theme
// shows through in the middle of an editor's surface. Truecolour throughout,
// because that is what `termguicolors` actually sends and because a 24-bit
// value proves the fill carried the exact colour rather than a palette slot
// that happens to be near it.
describe('back-colour erase covers every way a screen is cleared', () => {
  const SCHEME_BG = `${CSI}48;2;30;30;46m`;
  const scheme = 'rgb(30, 30, 46)';

  /** Backgrounds of one row's cells, `null` where the cell has no fill. */
  function backgrounds(term: ReturnType<typeof emulator>, row: number): (string | null)[] {
    return (term.frame().lines[row]?.cells ?? []).map((cell) => cell.style.background);
  }

  function filled(term: ReturnType<typeof emulator>, row: number, columns: number): boolean {
    const row_ = backgrounds(term, row);
    return row_.length === columns && row_.every((background) => background === scheme);
  }

  test('ED(2) fills the whole screen, every row and every column', () => {
    const term = emulator(8, 4);
    term.write(`${SCHEME_BG}${CSI}2J`);
    for (let row = 0; row < 4; row += 1) expect(filled(term, row, 8)).toBe(true);
  });

  test('ED(0) fills the rest of the cursor row and every row below it', () => {
    const term = emulator(8, 4);
    term.write(`${SCHEME_BG}${CSI}2;3H${CSI}0J`);
    expect(backgrounds(term, 1).slice(2)).toEqual(Array(6).fill(scheme));
    for (let row = 2; row < 4; row += 1) expect(filled(term, row, 8)).toBe(true);
  });

  test('ED(1) fills every row above the cursor and the row up to it', () => {
    const term = emulator(8, 4);
    term.write(`${SCHEME_BG}${CSI}3;4H${CSI}1J`);
    for (let row = 0; row < 2; row += 1) expect(filled(term, row, 8)).toBe(true);
    expect(backgrounds(term, 2).slice(0, 4)).toEqual(Array(4).fill(scheme));
  });

  test('EL(0), EL(1) and EL(2) each fill their span', () => {
    const toEnd = emulator(8, 2);
    toEnd.write(`ABCDEFGH${SCHEME_BG}${CSI}4G${CSI}0K`);
    expect(backgrounds(toEnd, 0).slice(3)).toEqual(Array(5).fill(scheme));

    const toStart = emulator(8, 2);
    toStart.write(`ABCDEFGH${SCHEME_BG}${CSI}4G${CSI}1K`);
    expect(backgrounds(toStart, 0).slice(0, 4)).toEqual(Array(4).fill(scheme));

    const whole = emulator(8, 2);
    whole.write(`ABCDEFGH${SCHEME_BG}${CSI}2K`);
    expect(filled(whole, 0, 8)).toBe(true);
  });

  test('ECH fills exactly the cells it erased', () => {
    const term = emulator(8, 2);
    term.write(`ABCDEFGH${SCHEME_BG}${CSI}3G${CSI}2X`);
    expect(backgrounds(term, 0).slice(2, 4)).toEqual([scheme, scheme]);
    expect(backgrounds(term, 0)[4]).toBeNull();
  });

  test('the blank rows a scroll opens carry the background too', () => {
    // A scroll region plus reverse index, which is how an editor repaints a
    // window: the row that appears must be the scheme's ground, not a hole.
    const up = emulator(8, 4);
    up.write(`A\nB\nC\nD${SCHEME_BG}${CSI}4;1H\n`);
    expect(filled(up, 3, 8)).toBe(true);

    const down = emulator(8, 4);
    down.write(`A\nB\nC\nD${SCHEME_BG}${CSI}1;1H${ESC}M`);
    expect(filled(down, 0, 8)).toBe(true);
  });

  test('inserted lines and inserted cells carry the background too', () => {
    const lines = emulator(8, 4);
    lines.write(`A\nB\nC\nD${SCHEME_BG}${CSI}2;1H${CSI}1L`);
    expect(filled(lines, 1, 8)).toBe(true);

    const cells = emulator(8, 2);
    cells.write(`ABCDEFGH${SCHEME_BG}${CSI}3G${CSI}2@`);
    expect(backgrounds(cells, 0).slice(2, 4)).toEqual([scheme, scheme]);
  });

  test('a reset before the clear puts the ground back to the default', () => {
    // The other direction of the same rule: BCE tracks the *current* SGR
    // background, so an editor that resets before clearing gets the terminal's
    // default back and the app is free to answer with its own surface.
    const term = emulator(8, 2);
    term.write(`${SCHEME_BG}${CSI}0m${CSI}2J`);
    expect(term.frame().lines[0]?.cells.every((cell) => cell.style.background === null)).toBe(true);
  });
});
