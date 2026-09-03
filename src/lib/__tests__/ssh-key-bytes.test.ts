/**
 * Every name the key row and the on-screen keyboard can emit, and the bytes a
 * PTY receives for it. Table-driven so the contract reads as a table: a name
 * that is missing from here is a tap the SSH terminal silently drops.
 */
import { describe, expect, test } from 'bun:test';

import { encodeTerminalKey, encodeTerminalText } from '@/lib/ssh-key-bytes';
import { EDITOR_ACTIONS, terminalKeysForPane } from '@/lib/terminal-keys';

const ESC = 0x1b;

function hex(bytes: Uint8Array | null): string | null {
  if (bytes === null) return null;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function ascii(text: string): string {
  return hex(Uint8Array.from([...text].map((char) => char.charCodeAt(0)))) ?? '';
}

describe('encodeTerminalKey', () => {
  const table: [string, string | null][] = [
    // The base row.
    ['enter', '0d'],
    ['shift+enter', '0a'],
    ['esc', '1b'],
    ['tab', '09'],
    ['shift+tab', ascii('\x1b[Z')],
    ['backspace', '7f'],
    ['space', '20'],
    ['delete', ascii('\x1b[3~')],
    ['insert', ascii('\x1b[2~')],
    // Control chords: 0x01 .. 0x1a.
    ['ctrl+a', '01'],
    ['ctrl+c', '03'],
    ['ctrl+d', '04'],
    ['ctrl+z', '1a'],
    ['ctrl+[', '1b'],
    ['ctrl+\\', '1c'],
    ['ctrl+]', '1d'],
    ['ctrl+^', '1e'],
    ['ctrl+_', '1f'],
    ['ctrl+space', '00'],
    ['ctrl+shift+w', '17'],
    ['ctrl+alt+x', '1b 18'],
    // Arrows, normal mode.
    ['up', ascii('\x1b[A')],
    ['down', ascii('\x1b[B')],
    ['right', ascii('\x1b[C')],
    ['left', ascii('\x1b[D')],
    ['home', ascii('\x1b[H')],
    ['end', ascii('\x1b[F')],
    ['pageup', ascii('\x1b[5~')],
    ['pagedown', ascii('\x1b[6~')],
    // Modified arrows carry xterm's modifier parameter.
    ['shift+up', ascii('\x1b[1;2A')],
    ['alt+up', ascii('\x1b[1;3A')],
    ['ctrl+left', ascii('\x1b[1;5D')],
    ['ctrl+right', ascii('\x1b[1;5C')],
    ['ctrl+shift+home', ascii('\x1b[1;6H')],
    ['ctrl+delete', ascii('\x1b[3;5~')],
    // Word motions: readline's meta-b / meta-f.
    ['alt+left', '1b 62'],
    ['alt+right', '1b 66'],
    ['alt+backspace', '1b 7f'],
    // Alt as a prefix.
    ['alt+d', '1b 64'],
    ['alt+shift+d', '1b 44'],
    ['alt+enter', '1b 0d'],
    ['cmd+left', '1b 62'],
    // Function keys.
    ['f1', '1b 4f 50'],
    ['f4', '1b 4f 53'],
    ['f5', ascii('\x1b[15~')],
    ['f12', ascii('\x1b[24~')],
    ['shift+f5', ascii('\x1b[15;2~')],
    // Single printable characters used as key names.
    ['a', '61'],
    ['shift+a', '41'],
    ['/', '2f'],
    // Names that carry no bytes of their own.
    ['nvim:w', null],
    ['nvim:leader:ff', null],
    ['', null],
    ['hyper+a', null],
    ['ctrl+enter', null],
  ];

  test.each(table)('%s', (name, expected) => {
    expect(hex(encodeTerminalKey(name))).toBe(expected);
  });

  test('names are matched case-insensitively and trimmed', () => {
    expect(hex(encodeTerminalKey(' Ctrl+C '))).toBe('03');
    expect(hex(encodeTerminalKey('ESC'))).toBe('1b');
  });

  test('application cursor keys switch arrows and home/end to SS3', () => {
    const mode = { applicationCursorKeys: true };
    expect(hex(encodeTerminalKey('up', mode))).toBe('1b 4f 41');
    expect(hex(encodeTerminalKey('left', mode))).toBe('1b 4f 44');
    expect(hex(encodeTerminalKey('home', mode))).toBe('1b 4f 48');
    expect(hex(encodeTerminalKey('end', mode))).toBe('1b 4f 46');
    // The tilde keys and modified arrows are the same in every mode.
    expect(hex(encodeTerminalKey('pageup', mode))).toBe(ascii('\x1b[5~'));
    expect(hex(encodeTerminalKey('shift+up', mode))).toBe(ascii('\x1b[1;2A'));
  });

  test('every key on the shell row either encodes or carries its own text', () => {
    const rows = [
      ...terminalKeysForPane(null),
      ...terminalKeysForPane('claude'),
      ...terminalKeysForPane('codex'),
      ...terminalKeysForPane(null, 'nvim'),
      ...EDITOR_ACTIONS,
    ];
    for (const item of rows) {
      const encoded = encodeTerminalKey(item.key);
      if (item.text !== undefined) {
        expect(encoded).toBeNull();
      } else {
        expect(encoded).not.toBeNull();
        expect(encoded!.byteLength).toBeGreaterThan(0);
      }
    }
  });

  test('every letter the on-screen keyboard can chord with ctrl has a control byte', () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const encoded = encodeTerminalKey(`ctrl+${letter}`);
      expect(encoded).not.toBeNull();
      expect(encoded![0]).toBe(letter.charCodeAt(0) - 0x60);
      expect(encoded!.byteLength).toBe(1);
    }
  });
});

describe('encodeTerminalText', () => {
  test('ASCII is itself', () => {
    expect(hex(encodeTerminalText('ls -la\n'))).toBe(ascii('ls -la\n'));
  });

  test('two-, three- and four-byte sequences', () => {
    expect(hex(encodeTerminalText('é'))).toBe('c3 a9');
    expect(hex(encodeTerminalText('中'))).toBe('e4 b8 ad');
    expect(hex(encodeTerminalText('😀'))).toBe('f0 9f 98 80');
  });

  test('a lone surrogate becomes U+FFFD rather than an invalid sequence', () => {
    expect(hex(encodeTerminalText('\ud83d'))).toBe('ef bf bd');
    expect(hex(encodeTerminalText('\ude00'))).toBe('ef bf bd');
  });

  test('empty in, empty out', () => {
    expect(encodeTerminalText('').byteLength).toBe(0);
  });

  test('round-trips through a real decoder', () => {
    const text = 'naïve 日本語 🎉 tail';
    expect(new TextDecoder().decode(encodeTerminalText(text))).toBe(text);
    expect(encodeTerminalKey('esc')![0]).toBe(ESC);
  });
});
