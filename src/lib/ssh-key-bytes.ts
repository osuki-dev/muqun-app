/**
 * Key names to the bytes a PTY expects.
 *
 * Every other terminal in this app talks to a gateway, and the gateway turned
 * `ctrl+c` into `0x03` on the reader's behalf; the key row and the on-screen
 * keyboard only ever emitted *names*. An SSH shell has no gateway in front of
 * it, so the translation has to happen here -- and it has to cover every name
 * `VirtualKeyboard` and `@/lib/terminal-keys` can produce, because a name this
 * table does not know is a tap that does nothing.
 *
 * The encoding is xterm's, with the cursor-key mode switch that every full
 * screen program flips (`DECCKM`): arrows and Home/End are CSI sequences in
 * normal mode and SS3 sequences in application mode. Nothing here parses the
 * mode off the output stream yet; the caller passes it, and passing nothing
 * means normal mode, which is what a shell prompt wants.
 *
 * Pure: bytes in tables, no React, no native module. The table-driven test
 * beside it is the contract.
 */

export interface TerminalKeyEncoding {
  /**
   * `DECCKM` is set: arrows and Home/End go out as `ESC O x` rather than
   * `ESC [ x`. Editors and pagers set it; a shell prompt does not.
   */
  applicationCursorKeys?: boolean;
}

const ESC = 0x1b;

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0x7f;
  return out;
}

/** `ESC [ <final>` or, in application mode, `ESC O <final>`. */
function cursorKey(final: string, applicationMode: boolean): Uint8Array {
  return bytes(ESC, applicationMode ? 0x4f : 0x5b, final.charCodeAt(0));
}

/** `ESC [ 1 ; <modifier> <final>` -- xterm's modified cursor keys. */
function modifiedCursorKey(final: string, modifier: number): Uint8Array {
  return ascii(`\x1b[1;${modifier}${final}`);
}

/** `ESC [ <code> ~`, with an optional `; <modifier>` before the tilde. */
function tildeKey(code: number, modifier?: number): Uint8Array {
  return ascii(modifier === undefined ? `\x1b[${code}~` : `\x1b[${code};${modifier}~`);
}

/**
 * xterm's modifier parameter: 1 + (shift 1, alt 2, ctrl 4). `2` is shift on
 * its own, `5` is ctrl, `3` is alt, `6` is ctrl+shift.
 */
function modifierParameter(mods: Set<string>): number {
  let value = 1;
  if (mods.has('shift')) value += 1;
  if (mods.has('alt')) value += 2;
  if (mods.has('ctrl')) value += 4;
  return value;
}

/** The arrow and edit keys, by their CSI final byte or tilde code. */
const CURSOR_FINALS: Record<string, string> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
};

const TILDE_CODES: Record<string, number> = {
  insert: 2,
  delete: 3,
  pageup: 5,
  pagedown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
};

/** F1-F4 are SS3 in every mode; only F5 and up are tilde keys. */
const SS3_FUNCTION_FINALS: Record<string, string> = {
  f1: 'P',
  f2: 'Q',
  f3: 'R',
  f4: 'S',
};

/** The unmodified keys with a single-byte answer. */
const PLAIN_BYTES: Record<string, Uint8Array> = {
  enter: bytes(0x0d),
  return: bytes(0x0d),
  // A newline without a submit -- what `shift+enter` means on the key row.
  'shift+enter': bytes(0x0a),
  tab: bytes(0x09),
  'shift+tab': ascii('\x1b[Z'),
  esc: bytes(ESC),
  escape: bytes(ESC),
  backspace: bytes(0x7f),
  space: bytes(0x20),
  'ctrl+space': bytes(0x00),
};

/** Word motions: readline and zsh both bind them to `ESC b` / `ESC f`. */
const WORD_MOTIONS: Record<string, Uint8Array> = {
  'alt+left': bytes(ESC, 0x62),
  'alt+right': bytes(ESC, 0x66),
  'alt+backspace': bytes(ESC, 0x7f),
};

/** The names a modifier may be spelled with on the row. `cmd` reads as alt. */
const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  meta: 'alt',
  cmd: 'alt',
  option: 'alt',
  shift: 'shift',
};

/**
 * A control chord's byte: `ctrl+a` … `ctrl+z` are 1 … 26, and the four
 * punctuation chords readline still uses sit just above them.
 */
function controlByte(base: string): number | null {
  if (base.length === 1) {
    const code = base.toLowerCase().charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) return code - 0x60;
    switch (base) {
      case '@':
      case '2':
        return 0x00;
      case '[':
      case '3':
        return 0x1b;
      case '\\':
      case '4':
        return 0x1c;
      case ']':
      case '5':
        return 0x1d;
      case '^':
      case '6':
        return 0x1e;
      case '_':
      case '7':
      case '-':
      case '/':
        return 0x1f;
      case '?':
      case '8':
        return 0x7f;
      default:
        return null;
    }
  }
  return null;
}

/**
 * The bytes for one named key, or `null` for a name that carries no bytes of
 * its own.
 *
 * `null` is not an error. The editor actions on the key row (`nvim:w`) are
 * identities with `text` beside them, and the caller sends that text; a name
 * nobody can spell into a PTY answers the same way rather than sending
 * something that happens to be wrong.
 */
export function encodeTerminalKey(
  keyName: string,
  encoding: TerminalKeyEncoding = {}
): Uint8Array | null {
  const name = keyName.trim().toLowerCase();
  if (!name) return null;

  const plain = PLAIN_BYTES[name] ?? WORD_MOTIONS[name];
  if (plain) return plain;

  const parts = name.split('+');
  const base = parts[parts.length - 1];
  if (!base) return null;
  const mods = new Set<'ctrl' | 'alt' | 'shift'>();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part];
    if (!modifier) return null;
    mods.add(modifier);
  }

  // `cmd+left` and `meta+left` are `alt+left` once the aliases are resolved,
  // so the spelled-out tables are consulted again under the canonical name.
  const canonical = [
    ...(['ctrl', 'alt', 'shift'] as const).filter((modifier) => mods.has(modifier)),
    base,
  ].join('+');
  const aliased = PLAIN_BYTES[canonical] ?? WORD_MOTIONS[canonical];
  if (aliased) return aliased;

  if (mods.size === 0) {
    if (base in CURSOR_FINALS)
      return cursorKey(CURSOR_FINALS[base], encoding.applicationCursorKeys === true);
    if (base in TILDE_CODES) return tildeKey(TILDE_CODES[base]);
    if (base in SS3_FUNCTION_FINALS)
      return bytes(ESC, 0x4f, SS3_FUNCTION_FINALS[base].charCodeAt(0));
    // A single printable character used as a key name is that character.
    if (base.length === 1 && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) < 0x7f) {
      return bytes(base.charCodeAt(0));
    }
    return null;
  }

  // Modified cursor and edit keys carry their modifier as a parameter, in
  // every mode: xterm drops application mode for a modified arrow.
  if (base in CURSOR_FINALS) return modifiedCursorKey(CURSOR_FINALS[base], modifierParameter(mods));
  if (base in TILDE_CODES) return tildeKey(TILDE_CODES[base], modifierParameter(mods));
  if (base in SS3_FUNCTION_FINALS)
    return modifiedCursorKey(SS3_FUNCTION_FINALS[base], modifierParameter(mods));

  // Ctrl wins over Shift: `ctrl+shift+w` and `ctrl+w` are the same byte.
  if (mods.has('ctrl')) {
    const byte = base === 'space' ? 0x00 : controlByte(base);
    if (byte === null) return null;
    return mods.has('alt') ? bytes(ESC, byte) : bytes(byte);
  }

  if (mods.has('alt')) {
    // `alt+x` is `ESC x`: what readline reads as Meta.
    if (base.length === 1) {
      const char = mods.has('shift') ? base.toUpperCase() : base;
      return bytes(ESC, char.charCodeAt(0));
    }
    const inner = PLAIN_BYTES[base];
    if (inner) return Uint8Array.from([ESC, ...inner]);
    return null;
  }

  // Shift on its own: a capital letter, or the plain key for anything shift
  // cannot change.
  if (base.length === 1) return bytes(base.toUpperCase().charCodeAt(0));
  const shifted = PLAIN_BYTES[base];
  return shifted ?? null;
}

/**
 * Typed text as UTF-8.
 *
 * Hand-rolled rather than `TextEncoder`, which Hermes does not ship. Lone
 * surrogates -- half an emoji, which a keyboard can hand over mid-composition
 * -- become U+FFFD rather than an invalid sequence the far side has to guess
 * at.
 */
export function encodeTerminalText(text: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}
