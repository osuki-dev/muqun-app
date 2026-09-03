// `resize` -- a new grid without losing scrollback -- and the two input-side
// modes the SSH key encoder reads off the emulator.
import { describe, expect, test } from 'bun:test';

import { TerminalEmulator } from '@/terminal/terminal-core';

import { CSI, cursorOf, emulator, lineText, textOf } from './helpers';

function lines(term: TerminalEmulator): string[] {
  return textOf(term).split('\n');
}

describe('resize', () => {
  test('reports the new dimensions and clamps them like the constructor', () => {
    const term = emulator(20, 6);
    term.resize(30, 10);
    expect(term.columns).toBe(30);
    expect(term.rows).toBe(10);
    term.resize(1, 1);
    expect(term.columns).toBe(2);
    expect(term.rows).toBe(2);
  });

  test('a wider grid keeps every row and pads them', () => {
    const term = emulator(10, 4, { scrollback: 10 });
    term.write('one\ntwo\nthree');
    term.resize(40, 4);
    expect(lines(term)).toEqual(['one', 'two', 'three']);
    expect(cursorOf(term.frame())).toMatchObject({ row: 2, column: 5 });
    term.write(' and a longer tail');
    expect(lineText(term.frame(), 2)).toBe('three and a longer tail');
  });

  test('a narrower grid cuts rows, scrollback included, without reflow', () => {
    const term = emulator(20, 3, { scrollback: 10 });
    term.write('0123456789abcdef\nsecond line here\nthird line here!\nfourth');
    term.resize(8, 3);
    expect(lines(term)).toEqual(['01234567', 'second l', 'third li', 'fourth']);
    expect(term.frame().columns).toBe(8);
  });

  test('a wide glyph cut in half at the new edge is blanked', () => {
    const term = emulator(6, 2);
    term.write('ab界cd');
    term.resize(3, 2);
    // The frame trims trailing blanks, so the blanked cell is simply gone --
    // and no half-glyph is left behind it.
    const cells = term.frame().lines[0].cells;
    expect(cells.map((cell) => cell.text).join('')).toBe('ab');
    expect(cells.every((cell) => cell.width === 1)).toBe(true);
    expect(term.frame().columns).toBe(3);
  });

  test('the cursor is clamped into the new grid', () => {
    const term = emulator(20, 6);
    term.write(`${CSI}6;18H`);
    term.resize(10, 3);
    expect(cursorOf(term.frame())).toMatchObject({ row: 2, column: 9 });
  });

  test('shrinking keeps a prompt at the top of an empty screen where it is', () => {
    const term = emulator(20, 24, { scrollback: 100 });
    term.write('$ ');
    term.resize(20, 10);
    const frame = term.frame();
    expect(frame.lines).toHaveLength(1);
    expect(lineText(frame, 0)).toBe('$');
    expect(cursorOf(frame)).toMatchObject({ row: 0, column: 2 });
  });

  test('shrinking a full screen pushes rows into scrollback so the cursor stays on screen', () => {
    const term = emulator(10, 6, { scrollback: 100 });
    term.write('r0\nr1\nr2\nr3\nr4\nr5');
    term.resize(10, 3);
    // Nothing is lost: the frame is scrollback plus screen.
    expect(lines(term)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    // The screen is the last three rows and the cursor is on its last row.
    expect(cursorOf(term.frame())).toMatchObject({ row: 5, column: 2 });
    term.write('\nr6');
    expect(lines(term)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
  });

  test('growing pulls rows back out of scrollback, so shrink then grow is a round trip', () => {
    const term = emulator(10, 6, { scrollback: 100 });
    term.write('r0\nr1\nr2\nr3\nr4\nr5');
    const before = term.frame();
    term.resize(10, 3);
    term.resize(10, 6);
    const after = term.frame();
    expect(after).toEqual(before);
    expect(cursorOf(after)).toMatchObject({ row: 5, column: 2 });
  });

  test('growing past the scrollback pads with blank rows at the bottom', () => {
    const term = emulator(10, 2, { scrollback: 1 });
    term.write('a\nb\nc\nd');
    // The one scrollback row holds 'b'; 'a' is gone.
    expect(lines(term)).toEqual(['b', 'c', 'd']);
    term.resize(10, 5);
    expect(lines(term)).toEqual(['b', 'c', 'd']);
    // 'b' came back onto the screen, so the cursor moved down with it.
    expect(cursorOf(term.frame())).toMatchObject({ row: 2 });
    term.write('\ne');
    expect(lines(term)).toEqual(['b', 'c', 'd', 'e']);
  });

  test('scrollback beyond the limit loses its oldest rows on a shrink', () => {
    const term = emulator(10, 4, { scrollback: 1 });
    term.write('a\nb\nc\nd');
    term.resize(10, 2);
    // Two rows have to leave the screen and only one fits in scrollback.
    expect(lines(term)).toEqual(['b', 'c', 'd']);
  });

  test('the alternate screen loses rows off its top and the main screen is resized underneath', () => {
    const term = emulator(10, 4, { scrollback: 10 });
    term.write('main0\nmain1\nmain2\nmain3');
    term.write(`${CSI}?1049h${CSI}Halt0\nalt1\nalt2\nalt3`);
    term.resize(10, 2);
    expect(lines(term)).toEqual(['alt2', 'alt3']);
    term.write(`${CSI}?1049l`);
    expect(lines(term)).toEqual(['main0', 'main1', 'main2', 'main3']);
    expect(term.rows).toBe(2);
  });

  test('a scroll region is reset by a resize', () => {
    const term = emulator(10, 6);
    term.write(`${CSI}2;4r`);
    term.resize(10, 5);
    term.write('a\nb\nc\nd\ne');
    expect(lines(term)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('the same size is a no-op', () => {
    const term = emulator(10, 4, { scrollback: 10 });
    term.write('x\ny');
    const before = term.frame();
    term.resize(10, 4);
    expect(term.frame()).toEqual(before);
  });

  test('output keeps streaming after a resize, wrapping at the new width', () => {
    const term = emulator(20, 4, { scrollback: 10 });
    term.write('start');
    term.resize(8, 4);
    term.write('0123456789');
    expect(lines(term)).toEqual(['start012', '3456789']);
  });

  test('a held sequence survives a resize', () => {
    const term = emulator(20, 4);
    term.write(`${CSI}3`);
    term.resize(30, 4);
    term.write('1mX');
    expect(textOf(term)).toBe('X');
  });
});

describe('input modes', () => {
  test('start off and reset off', () => {
    const term = emulator(10, 2);
    expect(term.modes).toEqual({
      applicationCursorKeys: false,
      bracketedPaste: false,
      alternateScreen: false,
    });
  });

  test('DECCKM follows CSI ?1 h and l', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?1h`);
    expect(term.modes.applicationCursorKeys).toBe(true);
    term.write(`${CSI}?1l`);
    expect(term.modes.applicationCursorKeys).toBe(false);
  });

  test('bracketed paste follows CSI ?2004 h and l', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?2004h`);
    expect(term.modes.bracketedPaste).toBe(true);
    term.write(`${CSI}?2004l`);
    expect(term.modes.bracketedPaste).toBe(false);
  });

  test('the alternate screen is reported for every spelling of the switch', () => {
    for (const mode of [47, 1047, 1049]) {
      const term = emulator(10, 2);
      term.write(`${CSI}?${mode}h`);
      expect(term.modes.alternateScreen).toBe(true);
      term.write(`${CSI}?${mode}l`);
      expect(term.modes.alternateScreen).toBe(false);
    }
  });

  test('reset leaves the alternate screen', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?1049h`);
    term.reset();
    expect(term.modes.alternateScreen).toBe(false);
  });

  test('several modes in one sequence', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?1;25;2004h`);
    expect(term.modes).toEqual({
      applicationCursorKeys: true,
      bracketedPaste: true,
      alternateScreen: false,
    });
  });

  test('a non-private mode 1 or 2004 is not DECCKM or bracketed paste', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}1h${CSI}2004h`);
    expect(term.modes).toEqual({
      applicationCursorKeys: false,
      bracketedPaste: false,
      alternateScreen: false,
    });
  });

  test('RIS clears them', () => {
    const term = emulator(10, 2);
    term.write(`${CSI}?1h${CSI}?2004h\x1bc`);
    expect(term.modes).toEqual({
      applicationCursorKeys: false,
      bracketedPaste: false,
      alternateScreen: false,
    });
  });

  test('the modes object is live, not a snapshot', () => {
    const term = emulator(10, 2);
    const modes = term.modes;
    term.write(`${CSI}?1h`);
    expect(modes.applicationCursorKeys).toBe(true);
  });

  test('flipping a mode does not touch the screen', () => {
    const term = emulator(10, 2);
    term.write('abc');
    const before = term.frame();
    term.write(`${CSI}?1h${CSI}?2004h`);
    expect(term.frame()).toEqual(before);
  });
});
