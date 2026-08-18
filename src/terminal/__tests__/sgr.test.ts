// SGR — colours and text attributes, full and partial resets.
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/sgr-compat.test.ts, parser-edge-cases.test.ts),
// MIT License, Copyright (c) 2026 Rahul Pandita. Colour outputs are our
// palette's resolved strings (see src/terminal/palette.ts), asserted against the
// default theme.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_TERMINAL_THEME } from '@/terminal/palette';
import { CSI, emulator, styleAt } from './helpers';

function styleOfFirstGlyph(sequence: string) {
  const term = emulator(20, 2);
  term.write(sequence);
  return styleAt(term.frame(), 0, 0);
}

describe('SGR colours', () => {
  test('basic 8-colour foreground maps to the theme palette', () => {
    expect(styleOfFirstGlyph(`${CSI}31mR`)?.foreground).toBe(DEFAULT_TERMINAL_THEME.ansi[1]);
  });

  test('basic 8-colour background maps to the theme palette', () => {
    expect(styleOfFirstGlyph(`${CSI}42mG`)?.background).toBe(DEFAULT_TERMINAL_THEME.ansi[2]);
  });

  test('bright foreground (90-97) maps to palette indices 8-15', () => {
    expect(styleOfFirstGlyph(`${CSI}91mR`)?.foreground).toBe(DEFAULT_TERMINAL_THEME.ansi[9]);
  });

  test('bright background (100-107) maps to palette indices 8-15', () => {
    expect(styleOfFirstGlyph(`${CSI}102mG`)?.background).toBe(DEFAULT_TERMINAL_THEME.ansi[10]);
  });

  test('256-colour foreground (38;5;196) resolves to the 6x6x6 cube', () => {
    expect(styleOfFirstGlyph(`${CSI}38;5;196mX`)?.foreground).toBe('rgb(255, 0, 0)');
  });

  test('256-colour background (48;5;21) resolves to the 6x6x6 cube', () => {
    expect(styleOfFirstGlyph(`${CSI}48;5;21mX`)?.background).toBe('rgb(0, 0, 255)');
  });

  test('24-bit truecolor foreground (38;2;r;g;b)', () => {
    expect(styleOfFirstGlyph(`${CSI}38;2;12;34;56mX`)?.foreground).toBe('rgb(12, 34, 56)');
  });

  test('24-bit truecolor background (48;2;r;g;b)', () => {
    expect(styleOfFirstGlyph(`${CSI}48;2;7;8;9mX`)?.background).toBe('rgb(7, 8, 9)');
  });

  test('colon-delimited truecolor sub-parameters are accepted', () => {
    expect(styleOfFirstGlyph(`${CSI}38:2::21:42:63mX`)?.foreground).toBe('rgb(21, 42, 63)');
  });

  // Underline colour (SGR 58/59) and the colon-form underline style (`4:n`,
  // e.g. nvim's undercurl spellcheck) are card #795's diagnosis: the parser
  // did not recognise either shape, so their arguments fell through and were
  // replayed as unrelated bare SGR codes. `TerminalStyle` still has nowhere to
  // put an underline colour, so these codes are consumed and discarded rather
  // than rendered -- the point is that they must never corrupt what follows.
  describe('underline colour and colon-form underline style (card #795)', () => {
    test('a colon-form underline style (4:3, curly) sets underline without also setting italic', () => {
      const style = styleOfFirstGlyph(`${CSI}4:3mX`);
      expect(style?.underline).toBe(true);
      expect(style?.italic).toBe(false);
    });

    test('4:0 clears underline the way SGR 24 does, rather than turning it on', () => {
      const style = styleOfFirstGlyph(`${CSI}4:0mX`);
      expect(style?.underline).toBe(false);
    });

    test('SGR 58 (RGB underline colour) does not leave the run dim', () => {
      // The real capture behind card #795: nvim's spellcheck squiggle sends
      // `4:3` then `58;2;243;139;168` for a flagged word. Unhandled, the `2`
      // (RGB mode selector) was replayed as bare SGR 2 and set `dim`.
      const style = styleOfFirstGlyph(`${CSI}4:3m${CSI}58;2;243;139;168mX`);
      expect(style?.dim).toBe(false);
      expect(style?.underline).toBe(true);
    });

    test('SGR 58 does not leak its RGB channels into the background', () => {
      // The mechanism behind the reported "bright blue background box": an
      // underline colour whose green or blue channel is 44 or 104 lands
      // exactly on this app's indexed background range (40-47, 100-107) once
      // unconsumed arguments are replayed as bare codes -- 44 is index 4
      // (ANSI blue) and 104 is index 12 (bright blue) in every theme this app
      // ships. A real background set immediately after must survive intact.
      const style = styleOfFirstGlyph(`${CSI}48;2;10;20;30m${CSI}58;2;5;44;104mX`);
      expect(style?.background).toBe('rgb(10, 20, 30)');
    });

    test('SGR 58 with the indexed form (58;5;n) is consumed the same way', () => {
      const style = styleOfFirstGlyph(`${CSI}48;2;10;20;30m${CSI}58;5;42mX`);
      expect(style?.background).toBe('rgb(10, 20, 30)');
      expect(style?.dim).toBe(false);
    });

    test('SGR 59 (reset underline colour) is a no-op', () => {
      const style = styleOfFirstGlyph(`${CSI}48;2;10;20;30m${CSI}59mX`);
      expect(style?.background).toBe('rgb(10, 20, 30)');
    });
  });
});

describe('SGR attributes', () => {
  test.each([
    ['bold', `${CSI}1mX`, 'bold'],
    ['dim', `${CSI}2mX`, 'dim'],
    ['italic', `${CSI}3mX`, 'italic'],
    ['underline', `${CSI}4mX`, 'underline'],
    ['inverse', `${CSI}7mX`, 'inverse'],
    ['hidden', `${CSI}8mX`, 'hidden'],
    ['strikethrough', `${CSI}9mX`, 'strikethrough'],
  ] as const)('%s attribute is set', (_name, sequence, key) => {
    expect(styleOfFirstGlyph(sequence)?.[key]).toBe(true);
  });

  test('multiple attributes accumulate in one SGR', () => {
    const style = styleOfFirstGlyph(`${CSI}1;3;4mX`);
    expect(style).toMatchObject({ bold: true, italic: true, underline: true });
  });
});

describe('SGR resets', () => {
  test('SGR 0 clears every attribute and colour', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}1;31;42mA${CSI}0mB`);
    const frame = term.frame();
    expect(styleAt(frame, 0, 1)).toMatchObject({
      bold: false,
      foreground: null,
      background: null,
    });
  });

  test('empty SGR (CSI m) is treated as a reset', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}1mA${CSI}mB`);
    expect(styleAt(term.frame(), 0, 1)?.bold).toBe(false);
  });

  test('SGR 22 clears both bold and dim, leaving other attributes', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}1;2;3mA${CSI}22mB`);
    expect(styleAt(term.frame(), 0, 1)).toMatchObject({ bold: false, dim: false, italic: true });
  });

  test.each([
    ['23 clears italic', `${CSI}3mA${CSI}23mB`, 'italic'],
    ['24 clears underline', `${CSI}4mA${CSI}24mB`, 'underline'],
    ['27 clears inverse', `${CSI}7mA${CSI}27mB`, 'inverse'],
  ] as const)('SGR %s', (_name, sequence, key) => {
    const term = emulator(20, 2);
    term.write(sequence);
    expect(styleAt(term.frame(), 0, 1)?.[key]).toBe(false);
  });

  test('SGR 39 restores the default foreground', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}31mA${CSI}39mB`);
    expect(styleAt(term.frame(), 0, 1)?.foreground).toBeNull();
  });

  test('SGR 49 restores the default background', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}42mA${CSI}49mB`);
    expect(styleAt(term.frame(), 0, 1)?.background).toBeNull();
  });
});
