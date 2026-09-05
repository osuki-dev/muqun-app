// A background a program painted to be *slightly different from its own
// terminal* has to stay slightly different from ours, whichever side of the
// pack we are on.
//
// The bytes below are not invented. They were captured with `tmux capture-pane
// -e -p` from a real Claude Code session (v2.1.260) in a tmux pane on a local
// gateway, driven through seven tool calls. Across that whole transcript the
// only background it emits is `48;5;237` -- on the row carrying the reader's
// own prompt -- with `38;5;231` text on it. Index 237 of the greyscale ramp is
// `rgb(58, 58, 58)`; index 231 is white. Against the dark pack's `#08111B`
// that is the faint input row Claude Code meant. Against the light pack's
// `#F7F3EC` it was a solid black bar with white text on it, which is what the
// maintainer photographed.
//
// What these tests hold down is a rule rather than a colour: the relationship
// the program asked for, expressed against the surface it actually lands on.
import { describe, expect, test } from 'bun:test';

import { resolveThemePack } from '@/constants/theme-packs';
import {
  createTerminalTheme,
  isLightTerminalSurface,
  terminalChromeBackground,
  terminalChromeForeground,
} from '@/terminal/palette';
import { adaptFrameChrome, readTerminalSurface } from '@/terminal/surface';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';

const pack = resolveThemePack('osuki');
const light = createTerminalTheme(pack, 'light');
const dark = createTerminalTheme(pack, 'dark');

const ESC = String.fromCharCode(27);
/** The captured row, byte for byte apart from the prompt glyph and its text. */
const CLAUDE_PROMPT_ROW = `${ESC}[38;5;239m${ESC}[48;5;237m> ${ESC}[38;5;231mrun ls, then run date${ESC}[39m`;
/** What index 237 resolves to, and what the reader saw instead of chrome. */
const CAPTURED_BACKGROUND = 'rgb(58, 58, 58)';

function luma(color: string): number {
  const rgb = /rgb\((\d+), (\d+), (\d+)\)/.exec(color);
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const [r, g, b] = rgb
    ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    : hex
      ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)]
      : [0, 0, 0];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const backgroundsOf = (frame: ReturnType<typeof parseTerminalSnapshot>) =>
  frame.lines.flatMap((line) => line.runs.map((run) => run.style.background));

describe('the background Claude Code actually paints', () => {
  test('the captured row is a black bar before the rule, on a light pack', () => {
    // The defect itself, stated as a fact about the parse: this is what was
    // being drawn, and it is why the bar was black.
    const parsed = parseTerminalSnapshot(CLAUDE_PROMPT_ROW, light, 80);
    expect(backgroundsOf(parsed)).toContain(CAPTURED_BACKGROUND);
    expect(luma(CAPTURED_BACKGROUND)).toBeLessThan(0.3);
  });

  test('the same row, adapted, is a band on the surface rather than a hole in it', () => {
    const parsed = parseTerminalSnapshot(CLAUDE_PROMPT_ROW, light, 80);
    const drawn = adaptFrameChrome(parsed, light);
    const painted = backgroundsOf(drawn).filter((color): color is string => Boolean(color));
    expect(painted.length).toBeGreaterThan(0);
    for (const color of painted) {
      // Not a black bar any more.
      expect(luma(color)).toBeGreaterThan(0.5);
      // Still visibly a band...
      expect(Math.abs(luma(color) - luma(light.background))).toBeGreaterThan(0.01);
      // ...and still the same surface, not a second one.
      expect(Math.abs(luma(color) - luma(light.background))).toBeLessThan(0.25);
    }
  });

  test('on the dark pack the program already meant what it said', () => {
    const parsed = parseTerminalSnapshot(CLAUDE_PROMPT_ROW, dark, 80);
    expect(adaptFrameChrome(parsed, dark)).toBe(parsed);
    expect(backgroundsOf(parsed)).toContain(CAPTURED_BACKGROUND);
  });
});

describe('the text on the band moves with it', () => {
  // Caught on the phone: the bands went right and the prompt text went white on
  // cream. Claude Code picks `48;5;237` and `38;5;231` as a pair -- white is
  // legible there exactly because the bar is dark.
  const foregroundsOf = (frame: ReturnType<typeof parseTerminalSnapshot>) =>
    frame.lines.flatMap((line) => line.runs.map((run) => run.style.foreground));

  test('white text on the captured bar becomes the pack ink', () => {
    const drawn = adaptFrameChrome(parseTerminalSnapshot(CLAUDE_PROMPT_ROW, light, 80), light);
    const onBand = drawn.lines
      .flatMap((line) => line.runs)
      .filter((run) => run.style.background !== null);
    expect(onBand.length).toBeGreaterThan(0);
    for (const run of onBand) {
      if (run.style.foreground === null) continue;
      expect(luma(run.style.foreground)).toBeLessThan(0.5);
    }
    expect(foregroundsOf(drawn)).toContain(light.foreground);
  });

  test('a coloured foreground is carrying meaning and is kept', () => {
    for (const color of ['rgb(220, 80, 80)', 'rgb(80, 200, 120)']) {
      expect(terminalChromeForeground(color, light)).toBe(color);
    }
  });

  test('a foreground that was already dark is left alone', () => {
    expect(terminalChromeForeground('rgb(40, 40, 40)', light)).toBe('rgb(40, 40, 40)');
  });

  test('on a dark pack nothing moves', () => {
    expect(terminalChromeForeground('rgb(255, 255, 255)', dark)).toBe('rgb(255, 255, 255)');
  });

  test('text that never had a band of its own is untouched', () => {
    // Only a run whose background actually moved gets its foreground looked at.
    const plain = `${ESC}[38;5;231mwhite on the terminal's own surface${ESC}[39m`;
    const parsed = parseTerminalSnapshot(plain, light, 80);
    expect(adaptFrameChrome(parsed, light)).toBe(parsed);
  });
});

describe('what the rule declines to touch', () => {
  test('a colour is a decision, not chrome', () => {
    for (const color of ['rgb(120, 20, 20)', 'rgb(20, 20, 120)', 'rgb(0, 90, 40)']) {
      expect(terminalChromeBackground(color, light)).toBe(color);
    }
  });

  test('a mid grey is a choice rather than a step away from black', () => {
    expect(terminalChromeBackground('rgb(140, 140, 140)', light)).toBe('rgb(140, 140, 140)');
  });

  test('a light background needs no help on a light pack', () => {
    expect(terminalChromeBackground('rgb(230, 230, 230)', light)).toBe('rgb(230, 230, 230)');
  });

  test("the pack's own sixteen are already wearing our palette", () => {
    // ANSI 16 arrives as the pack's hex, which the rule does not even
    // recognise as a colour a program named.
    for (const slot of [0, 1, 8, 15]) {
      expect(terminalChromeBackground(light.ansi[slot], light)).toBe(light.ansi[slot]);
    }
  });

  test('a frame with nothing to change is handed back by identity', () => {
    const plain = parseTerminalSnapshot('no colours here at all', light, 80);
    expect(adaptFrameChrome(plain, light)).toBe(plain);
  });
});

describe('the surface a full-screen program painted is still read from the truth', () => {
  test('an adopted scheme is untouched, because the frame is adapted after it is read', () => {
    // The ordering that matters: `readTerminalSurface` runs on the parse, which
    // is faithful; only what gets drawn is adapted. An editor painting its own
    // dark scheme keeps it.
    // A surface has to be *covered* to count as one, so this is a screen the
    // way an editor paints one rather than a single row.
    const row = (text: string) =>
      `${ESC}[48;2;33;35;55m${ESC}[38;2;220;223;228m${text.padEnd(40)}${ESC}[0m`;
    const screen = [row('  hello'), row('  ~'), row('  ~'), row('  ~')].join('\n');
    const parsed = parseTerminalSnapshot(screen, light, 40);
    expect(readTerminalSurface(parsed).background).toBe('rgb(33, 35, 55)');
    // And the rule would have flattened it, had it been asked -- which is
    // exactly why it is asked only after the surface has been read.
    expect(terminalChromeBackground('rgb(33, 35, 55)', light)).not.toBe('rgb(33, 35, 55)');
  });

  test('the pack sides are what they say they are', () => {
    expect(isLightTerminalSurface(light)).toBe(true);
    expect(isLightTerminalSurface(dark)).toBe(false);
  });
});
