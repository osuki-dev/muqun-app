/**
 * A keypress is a keystroke, and only a composed line is a paste.
 *
 * The defect this pins: every character the app's own keyboard put into a
 * gateway pane went out as `send-text`, which the gateway pastes with tmux's
 * `-p`, which is a bracketed paste, which nvim hands to its paste handler
 * instead of its keymap. `i` did not enter insert mode -- it typed the letter
 * into the file, and on a buffer that cannot be written (nvim's dashboard, a
 * file tree) it did nothing whatsoever.
 *
 * The table is the fix, so the table is the test.
 */
import { describe, expect, test } from 'bun:test';

import {
  isSendableAsKeystrokes,
  paneInputDelivery,
  paneKeystrokes,
  type PaneInputSource,
} from '@/lib/pane-input';

const EVERY_SOURCE: PaneInputSource[] = ['virtual-key', 'terminal-key', 'composer'];

describe('what is a keystroke and what is a paste', () => {
  test('a key press is keys, on either keyboard the app draws', () => {
    // The QWERTY and the terminal key row are both keyboards: the reader
    // pressed a key and the program is waiting for a key.
    expect(paneInputDelivery('virtual-key')).toBe('keystrokes');
    expect(paneInputDelivery('terminal-key')).toBe('keystrokes');
  });

  test('a line the reader assembled and sent is a paste', () => {
    // Not a length rule. The paste is what keeps a two-line message one
    // message rather than two Enters, and it is the only channel by which an
    // agent recognises an attachment path as an image.
    expect(paneInputDelivery('composer')).toBe('paste');
  });

  test('every source has an answer and it is one of the two', () => {
    for (const source of EVERY_SOURCE) {
      expect(['keystrokes', 'paste']).toContain(paneInputDelivery(source));
    }
  });
});

describe('what one press of a character-capped key is worth', () => {
  test('a single letter is a single key', () => {
    expect(paneKeystrokes('i')).toEqual(['i']);
  });

  test('a two-letter vim command is two keys, not a two-character paste', () => {
    // `dd` pasted is the string "dd" in the buffer; `dd` typed deletes a line.
    expect(paneKeystrokes('dd')).toEqual(['d', 'd']);
    expect(paneKeystrokes('gg')).toEqual(['g', 'g']);
  });

  test('a colon command carries its Enter in the same request', () => {
    // One request, so the Enter cannot interleave with the next press and run
    // a half-typed command line.
    expect(paneKeystrokes(':w', { submit: true })).toEqual([':', 'w', 'enter']);
    expect(paneKeystrokes(':wq', { submit: true })).toEqual([':', 'w', 'q', 'enter']);
  });

  test('a command that is not submitted does not grow an Enter', () => {
    // `/` and `:` open a line the reader then types into; sending Enter would
    // run the empty one.
    expect(paneKeystrokes('/')).toEqual(['/']);
    expect(paneKeystrokes(':')).toEqual([':']);
  });
});

describe('what cannot go as keys falls back rather than failing', () => {
  test('the printable characters the app can type are all sendable', () => {
    // Everything on the app's keyboard: the letters, the digits, and both
    // symbol pages -- including the semicolon, which the gateway escapes for
    // tmux and which arrives as a character.
    const typable =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
      ' -/:;()$&@".,?!\'~|_\\=+[]{}#%<>`^*';
    for (const character of typable) {
      expect(isSendableAsKeystrokes(character)).toBe(true);
    }
  });

  test('a newline is not a key, because as a key it is Enter', () => {
    // The one that would do damage: a two-line payload split into keys submits
    // halfway through.
    expect(isSendableAsKeystrokes('one\ntwo')).toBe(false);
    expect(isSendableAsKeystrokes('\n')).toBe(false);
    expect(isSendableAsKeystrokes('\r')).toBe(false);
    // Tab has a key name of its own; as a character it is a control.
    expect(isSendableAsKeystrokes('\t')).toBe(false);
    // C1 as well, which is what the gateway's `char::is_control` covers.
    expect(isSendableAsKeystrokes('\u0085')).toBe(false);
  });

  test('the two sides split a string on the same boundary', () => {
    // Rust's `char` is a Unicode scalar value and so is what `Array.from`
    // yields, so an astral character is one key on both sides and needs no
    // special case. Asserted rather than assumed, because if the two ever
    // disagreed the failure would be a 400 on a keypress.
    expect(isSendableAsKeystrokes('\u{1F600}')).toBe(true);
    expect(paneKeystrokes('\u{1F600}')).toEqual(['\u{1F600}']);
    // A decomposed accent is genuinely two scalars, so it is genuinely two
    // keys -- and typing both in order puts the same character on screen.
    expect(paneKeystrokes('e\u0301')).toEqual(['e', '\u0301']);
    expect(paneKeystrokes('\u00e9')).toEqual(['\u00e9']);
  });

  test('nothing at all is not a keystroke', () => {
    expect(isSendableAsKeystrokes('')).toBe(false);
  });
});
