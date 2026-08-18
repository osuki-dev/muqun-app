import { terminalIndexedColor, terminalRgbColor, type TerminalTheme } from '@/terminal/palette';
import { cloneTerminalStyle, DEFAULT_TERMINAL_STYLE, type TerminalStyle } from '@/terminal/types';

/**
 * SGR (`CSI ... m`) parameter parsing and application, shared by the full
 * emulator and the line-oriented snapshot fast path so the two cannot drift on
 * what `\x1b[38;5;196m` means. Both paths carry one mutable `TerminalStyle` and
 * hand it here; nothing else touches the style bits.
 */

/**
 * Splits a raw CSI parameter string into SGR codes. Colon sub-parameters
 * (`38:2::12:34:56`) are flattened to semicolon form, which is what
 * `applySgrCodes` reads, and empty parameters count as 0 (`\x1b[m` == reset).
 *
 * `4:n` (underline style -- kitty/iTerm's colon form for curly, double,
 * dotted and dashed underlines, e.g. nvim's undercurl spellcheck) is the one
 * colon group this flattening cannot pass through unchanged: unlike
 * `38:2:...`/`48:2:...`, whose trailing numbers are colour channels
 * `applySgrCodes` already knows to consume, a flattened `4:3` is
 * indistinguishable from the two independent codes "4" then "3" -- and 3 is
 * SGR 3 (italic). `TerminalStyle` has no underline-style field, so the style
 * digit is resolved here, where the colon grouping is still visible, rather
 * than replayed as a bare code downstream: `4:0` is the one digit that means
 * "off" (mirrors SGR 24); every other style digit means "on" (plain SGR 4).
 */
export function parseSgrValues(raw: string): number[] {
  const value = raw.replace(/^[?>!]/, '');
  if (!value) return [0];
  return value.split(';').flatMap((entry) => {
    if (!entry.includes(':')) return [Number(entry || 0)];
    const parts = entry.split(':').filter((part) => part.length > 0);
    if (Number(parts[0] || 0) === 4) {
      return [Number(parts[1] ?? 1) === 0 ? 24 : 4];
    }
    return parts.map((part) => Number(part || 0));
  });
}

/**
 * Applies `codes` to `style` and returns the style to carry forward. Attribute
 * codes mutate the style in place; a reset (code 0) yields a fresh default
 * style, so callers must use the return value rather than assume mutation.
 */
export function applySgrCodes(
  style: TerminalStyle,
  codes: number[],
  theme: TerminalTheme
): TerminalStyle {
  let current = style;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0) current = cloneTerminalStyle(DEFAULT_TERMINAL_STYLE);
    else if (code === 1) current.bold = true;
    else if (code === 2) current.dim = true;
    else if (code === 3) current.italic = true;
    else if (code === 4 || code === 21) current.underline = true;
    else if (code === 7) current.inverse = true;
    else if (code === 8) current.hidden = true;
    else if (code === 9) current.strikethrough = true;
    else if (code === 22) {
      current.bold = false;
      current.dim = false;
    } else if (code === 23) current.italic = false;
    else if (code === 24) current.underline = false;
    else if (code === 27) current.inverse = false;
    else if (code === 28) current.hidden = false;
    else if (code === 29) current.strikethrough = false;
    else if (code >= 30 && code <= 37) {
      current.foreground = terminalIndexedColor(code - 30, theme);
    }
    else if (code === 39) current.foreground = null;
    else if (code >= 40 && code <= 47) {
      current.background = terminalIndexedColor(code - 40, theme);
    }
    else if (code === 49) current.background = null;
    else if (code >= 90 && code <= 97) {
      current.foreground = terminalIndexedColor(code - 90 + 8, theme);
    } else if (code >= 100 && code <= 107) {
      current.background = terminalIndexedColor(code - 100 + 8, theme);
    }
    else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const color = terminalIndexedColor(codes[index + 2] ?? 7, theme);
      if (code === 38) current.foreground = color;
      else current.background = color;
      index += 2;
    } else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
      const color = terminalRgbColor(codes[index + 2], codes[index + 3], codes[index + 4]);
      if (code === 38) current.foreground = color;
      else current.background = color;
      index += 4;
    }
    // SGR 58 (set underline colour) and 59 (reset it) -- nvim's own undercurl
    // spellcheck sends `58;2;r;g;b` alongside `4:3` for a flagged word.
    // `TerminalStyle` has no field for it (underline always draws in the
    // run's foreground, see `drawRunCells`), so the colour itself is
    // discarded, but its arguments still have to be consumed here the same
    // way 38/48's are. Left unhandled, code 58 fell through untouched and the
    // very next number -- the colour-space selector, always 2 (RGB) or 5
    // (indexed) -- was replayed as a bare SGR code on the *next* loop turn:
    // 2 is `dim`, and if either remaining channel happened to equal 40-47 or
    // 100-107 it silently overwrote the run's real background with one of
    // this theme's sixteen ANSI colours (44 and 104 land on this app's own
    // "blue" and "bright blue" in every theme it ships) -- measured against
    // the real capture behind card #795.
    else if (code === 58 && codes[index + 1] === 5) {
      index += 2;
    } else if (code === 58 && codes[index + 1] === 2) {
      index += 4;
    } else if (code === 59) {
      // No-op: nothing is stored for 58 to reset.
    }
  }
  return current;
}
