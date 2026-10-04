// Whose surface a pane is, and what the app is allowed to do about it.
//
// The scenario behind every case here is card #685: a real nvim on a real
// gateway, a truecolour scheme, and an app wearing its light theme. The bytes
// in `NETRW` are the shape the gateway actually sent for that pane -- rows of
// 24-bit foreground with no background at all, a few rows where the scheme did
// paint one -- and the assertion is that the app answers such a pane with one
// continuous surface instead of the app's paper showing between the chips.
import { describe, expect, test } from 'bun:test';

import { resolveThemePack } from '@/constants/theme-packs';
import { createTerminalTheme, terminalPaneTheme } from '@/terminal/palette';
import { isDarkSurface, readTerminalSurface, type TerminalSurface } from '@/terminal/surface';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';
import type { TerminalFrame } from '@/terminal/types';

const CSI = '\x1b[';
const pack = resolveThemePack('catppuccin');
const light = createTerminalTheme(pack, 'light');
const dark = createTerminalTheme(pack, 'dark');

/** A frame the way the renderer gets one: through the real parser. */
function frameOf(rows: string[]): TerminalFrame {
  return parseTerminalSnapshot(rows.join('\n'), light);
}

/** A row that ends with the terminal default, as a transparent scheme leaves it. */
function transparentRow(text: string): string {
  return `${CSI}0m${CSI}38;2;200;211;245m${text}${CSI}0m`;
}

/** A row the scheme painted end to end, as an opaque scheme leaves it. */
function paintedRow(text: string, width: number): string {
  const padding = ' '.repeat(Math.max(0, width - text.length));
  return `${CSI}0m${CSI}38;2;200;211;245m${CSI}48;2;33;35;55m${text}${padding}${CSI}0m`;
}

// A netrw listing under a scheme with a transparent `Normal`: directory names
// carry the scheme's own chip, every other cell is left at the default. This is
// the frame that rendered as patchwork.
const NETRW = [
  transparentRow('" Netrw Directory Listing'),
  `${CSI}0m${CSI}38;2;130;170;255m${CSI}48;2;15;17;23m.agents${CSI}0m`,
  `${CSI}0m${CSI}38;2;130;170;255m${CSI}48;2;15;17;23m.claude${CSI}0m`,
  transparentRow('README.md'),
  transparentRow('package.json'),
];

describe('readTerminalSurface', () => {
  test('reports no surface when the scheme paints only chips on default ground', () => {
    const surface = readTerminalSurface(frameOf(NETRW));
    expect(surface.background).toBeNull();
    expect(surface.verbatim).toBe(true);
  });

  test('reports the scheme background when the scheme paints the screen', () => {
    const surface = readTerminalSurface(frameOf([paintedRow('hello', 40), paintedRow('~', 40)]));
    expect(surface.background).toBe('rgb(33, 35, 55)');
    expect(surface.verbatim).toBe(true);
  });

  test('a majority is required, so the widest chip on default ground never wins', () => {
    // Three rows of forty columns; one row is painted, which is a third of the
    // screen and the largest single fill on it.
    const frame = frameOf([paintedRow('status', 40), transparentRow('one'), transparentRow('two')]);
    expect(readTerminalSurface(frame).background).toBeNull();
  });

  test('an inverse run is an accent, not a surface, however wide it is', () => {
    const inverted = `${CSI}0m${CSI}7m${CSI}38;2;33;35;55m${' '.repeat(40)}${CSI}0m`;
    const frame = frameOf([inverted, inverted, transparentRow('x')]);
    expect(readTerminalSurface(frame).background).toBeNull();
  });

  test('a pane that stayed inside ANSI 16 is not verbatim, whatever it painted', () => {
    const row = `${CSI}0m${CSI}44m${' '.repeat(40)}${CSI}0m`;
    const surface = readTerminalSurface(frameOf([row, row]));
    expect(surface.verbatim).toBe(false);
    expect(surface.background).toBe(light.ansi[4]);
  });

  test('the 256-colour cube counts as verbatim; the sixteen slots do not', () => {
    expect(readTerminalSurface(frameOf([`${CSI}38;5;196mred${CSI}0m`])).verbatim).toBe(true);
    expect(readTerminalSurface(frameOf([`${CSI}38;5;9mred${CSI}0m`])).verbatim).toBe(false);
  });

  test('screenRows limits the read to the live screen at the tail', () => {
    // A shell prompt that scrolled off before the editor started must not get a
    // vote: with the last two rows taken as the screen, the editor's own paint
    // is a majority even though it is a minority of the whole window.
    const window = [
      transparentRow('$ ls'),
      transparentRow('$ nvim .'),
      paintedRow('hello', 40),
      paintedRow('~', 40),
    ];
    expect(readTerminalSurface(frameOf(window)).background).toBeNull();
    expect(readTerminalSurface(frameOf(window), 2).background).toBe('rgb(33, 35, 55)');
  });

  test('an empty frame claims nothing', () => {
    const surface = readTerminalSurface(frameOf(['']));
    expect(surface.background).toBeNull();
    expect(surface.verbatim).toBe(false);
  });
});

describe('readTerminalSurface across snapshots', () => {
  /** Ten rows of forty columns with `painted` of them painted end to end. */
  function screenWithPainted(painted: number): TerminalFrame {
    return frameOf(
      Array.from({ length: 10 }, (_, row) =>
        row < painted ? paintedRow(`row ${row}`, 40) : transparentRow(`row ${row}`)
      )
    );
  }

  /** Reads `shares` in order, each against the last answer, as the pane does. */
  function readSequence(painted: number[]): (string | null)[] {
    let previous: TerminalSurface | undefined;
    return painted.map((count) => {
      previous = readTerminalSurface(screenWithPainted(count), 0, previous);
      return previous.background;
    });
  }

  const SURFACE = 'rgb(33, 35, 55)';

  test('a screen hovering at half no longer flips the surface every snapshot', () => {
    // The bare-majority rule answered this sequence with a flip on every read.
    expect(readSequence([6, 5, 6, 5, 6, 5])).toEqual(Array(6).fill(SURFACE));
    expect(readSequence([5, 6, 5, 6, 5, 6])).toEqual([null, ...Array(5).fill(SURFACE)]);
  });

  test('adopts only above the adopt share, releases only below the release share', () => {
    expect(readSequence([5, 6, 5, 4, 5, 6])).toEqual([null, SURFACE, SURFACE, null, null, SURFACE]);
  });

  test('a cold read needs the adopt share, not a bare majority', () => {
    expect(readTerminalSurface(screenWithPainted(5)).background).toBeNull();
    expect(readTerminalSurface(screenWithPainted(6)).background).toBe(SURFACE);
  });

  test('a different surface that clearly owns the screen takes over at once', () => {
    const held = readTerminalSurface(screenWithPainted(10));
    const paper = `${CSI}0m${CSI}38;2;76;79;105m${CSI}48;2;239;241;245m${' '.repeat(40)}${CSI}0m`;
    const repainted = frameOf(Array(10).fill(paper));
    expect(readTerminalSurface(repainted, 0, held).background).toBe('rgb(239, 241, 245)');
  });

  test('verbatim colour is let go only after two snapshots without it', () => {
    const plain = frameOf([`${CSI}44m${' '.repeat(40)}${CSI}0m`, 'x']);
    const seen = readTerminalSurface(frameOf(NETRW));
    expect(seen.verbatim).toBe(true);
    const once = readTerminalSurface(plain, 0, seen);
    expect(once.verbatim).toBe(true);
    // Seen again: the miss is forgotten, and it takes two fresh misses to go.
    const back = readTerminalSurface(frameOf(NETRW), 0, once);
    expect(back.verbatimMissed).toBeUndefined();
    const twice = readTerminalSurface(plain, 0, readTerminalSurface(plain, 0, back));
    expect(twice.verbatim).toBe(false);
    // Through it all the pane theme held still until the release.
    expect(terminalPaneTheme(pack, light, once, true)).toBe(
      terminalPaneTheme(pack, light, seen, true)
    );
    expect(terminalPaneTheme(pack, light, twice, true)).toBe(light);
  });
});

describe('isDarkSurface', () => {
  test('reads both spellings the palette produces', () => {
    expect(isDarkSurface('rgb(30, 30, 46)')).toBe(true);
    expect(isDarkSurface('#1e1e2e')).toBe(true);
    expect(isDarkSurface('#eff1f5')).toBe(false);
    expect(isDarkSurface('#fff')).toBe(false);
  });
});

describe('terminalPaneTheme', () => {
  const netrw = readTerminalSurface(frameOf(NETRW));

  test('a pane that does not own the screen keeps the app theme, by identity', () => {
    expect(terminalPaneTheme(pack, light, netrw, false)).toBe(light);
  });

  test('a full-screen pane inside ANSI 16 keeps the app theme, by identity', () => {
    const surface = readTerminalSurface(frameOf([`${CSI}44m${' '.repeat(40)}${CSI}0m`]));
    expect(terminalPaneTheme(pack, light, surface, true)).toBe(light);
  });

  test('the patchwork case: a truecolour editor stops following the light app', () => {
    const theme = terminalPaneTheme(pack, light, netrw, true);
    expect(theme.background).toBe(dark.background);
    expect(theme.foreground).toBe(dark.foreground);
    // The chips the scheme did paint are still exactly what it sent -- nothing
    // about adopting a surface remaps a colour the program named.
    const chip = frameOf(NETRW).lines[1].runs[0].style.background;
    expect(chip).toBe('rgb(15, 17, 23)');
  });

  test('a scheme that painted its own surface gets that surface, not ours', () => {
    const surface = readTerminalSurface(frameOf([paintedRow('hello', 40), paintedRow('~', 40)]));
    const theme = terminalPaneTheme(pack, light, surface, true);
    expect(theme.background).toBe('rgb(33, 35, 55)');
    // Dark ground, so the defaults come from the pack's dark side and a
    // default-coloured glyph stays legible on it.
    expect(theme.foreground).toBe(dark.foreground);
  });

  test('a light scheme keeps its light defaults on a dark app', () => {
    const paper = `${CSI}0m${CSI}48;2;239;241;245m${' '.repeat(40)}${CSI}0m`;
    const surface = readTerminalSurface(frameOf([paper, paper]));
    const theme = terminalPaneTheme(pack, dark, surface, true);
    expect(theme.background).toBe('rgb(239, 241, 245)');
    expect(theme.foreground).toBe(light.foreground);
  });

  test('under a dark app the same editor is already home, and nothing changes', () => {
    expect(terminalPaneTheme(pack, dark, netrw, true)).toBe(dark);
  });
});
