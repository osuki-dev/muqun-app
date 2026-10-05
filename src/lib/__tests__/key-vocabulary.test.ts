import { describe, expect, test } from 'bun:test';

import {
  allowChord,
  chordGlyph,
  heldBackModifiers,
  isKeyUnsupportedError,
  keyFailureOutcome,
  paneVocabulary,
  parseKeyboardVocabulary,
  vocabularyForSession,
  type KeyboardVocabulary,
} from '../key-vocabulary';
import { parseTerminalDiscovery } from '../agent-protocol';
import {
  emptyAgentsMirror,
  mirrorDiscovery,
  parseAgentsMirrorIndex,
  serializeAgentsMirrorIndex,
  withMirroredDiscovery,
} from '../agent-discovery';

const BASES = [
  'enter',
  'esc',
  'tab',
  'backspace',
  'space',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'insert',
  'delete',
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
];

const extended: KeyboardVocabulary = {
  version: 1,
  bases: BASES,
  modifiers: ['ctrl', 'alt', 'shift'],
  extended: true,
};
const classicOnly: KeyboardVocabulary = { ...extended, extended: false };

describe('allowChord', () => {
  test('without a vocabulary the SSH encoder decides, as before', () => {
    expect(allowChord('ctrl+c', undefined)).toBe(true);
    expect(allowChord('alt+left', undefined)).toBe(true);
    expect(allowChord('ctrl+up', undefined)).toBe(true);
    // The encoder has no bytes for these, which is the whole reason for the vocabulary.
    expect(allowChord('ctrl+enter', undefined)).toBe(false);
    expect(allowChord('ctrl+!', undefined)).toBe(false);
  });

  test('the classic set is deliverable even without extended keys', () => {
    for (let code = 97; code <= 122; code++) {
      expect(allowChord(`ctrl+${String.fromCharCode(code)}`, classicOnly)).toBe(true);
    }
    for (const key of ['ctrl+[', 'ctrl+]', 'ctrl+\\', 'ctrl+space', 'shift+tab']) {
      expect(allowChord(key, classicOnly)).toBe(true);
    }
  });

  test('modifier + special key needs extended', () => {
    for (const key of [
      'ctrl+enter',
      'shift+enter',
      'ctrl+up',
      'alt+left',
      'alt+x',
      'ctrl+shift+home',
      'alt+enter',
      'ctrl+alt+shift+f5',
      'ctrl+shift+a',
    ]) {
      expect(allowChord(key, extended)).toBe(true);
      expect(allowChord(key, classicOnly)).toBe(false);
    }
  });

  test('plain bases and single printable characters always go', () => {
    for (const key of [...BASES, 'a', 'Z', '!', '~', ' ', '\\']) {
      expect(allowChord(key, classicOnly)).toBe(true);
    }
  });

  test('an unknown modifier is refused', () => {
    expect(allowChord('cmd+c', extended)).toBe(false);
    expect(allowChord('meta+x', extended)).toBe(false);
    const noAlt = { ...extended, modifiers: ['ctrl', 'shift'] };
    expect(allowChord('alt+x', noAlt)).toBe(false);
    expect(allowChord('ctrl+c', noAlt)).toBe(true);
  });

  test('an unknown base is refused, with or without a modifier', () => {
    expect(allowChord('f13', extended)).toBe(false);
    expect(allowChord('ctrl+f13', extended)).toBe(false);
    expect(allowChord('escape', extended)).toBe(false);
    expect(allowChord('ctrl+', extended)).toBe(false);
    const noHome = {
      ...extended,
      bases: BASES.filter((base) => base !== 'home'),
    };
    expect(allowChord('home', noHome)).toBe(false);
  });

  test('shift+tab is classic, but only when shift is an advertised modifier', () => {
    expect(allowChord('shift+tab', classicOnly)).toBe(true);
    expect(allowChord('shift+tab', { ...classicOnly, modifiers: ['ctrl', 'alt'] })).toBe(false);
  });
});

describe('the vocabulary on the wire', () => {
  const backend = {
    sessionId: 'default',
    kind: 'tmux',
    connected: true,
    keyboard: {
      version: 1,
      bases: BASES,
      modifiers: ['ctrl', 'alt', 'shift'],
      extended: true,
    },
  };

  test('parses, and anything malformed is absent rather than empty', () => {
    expect(parseKeyboardVocabulary(backend.keyboard)).toEqual(extended);
    expect(parseKeyboardVocabulary(undefined)).toBeUndefined();
    expect(parseKeyboardVocabulary({ bases: 'enter', modifiers: [] })).toBeUndefined();
    expect(parseKeyboardVocabulary([])).toBeUndefined();
    expect(parseKeyboardVocabulary({ bases: [], modifiers: [] })?.extended).toBe(false);
  });

  test('rides through the terminal plane and the mirror', () => {
    const terminal = parseTerminalDiscovery({
      supported: true,
      mode: 'auto',
      activeBackend: 'herdr',
      backends: [{ sessionId: 'herdr', kind: 'herdr', connected: true }, backend],
    });
    expect(terminal?.backends[0].keyboard).toBeUndefined();
    expect(terminal?.backends[1].keyboard).toEqual(extended);

    const index = withMirroredDiscovery(
      emptyAgentsMirror(),
      'server',
      mirrorDiscovery({ agents: null, terminal, ssh: null }, 1)
    );
    const restored = parseAgentsMirrorIndex(serializeAgentsMirrorIndex(index));
    expect(restored.servers.server.terminal?.backends[1].keyboard).toEqual(extended);
  });

  test("a pane takes its own session's backend, then the active one, then none", () => {
    const terminal = {
      activeBackend: 'default',
      backends: [{ sessionId: 'herdr' }, { sessionId: 'default', keyboard: extended }],
    };
    expect(vocabularyForSession(terminal, 'herdr')).toBeUndefined();
    expect(vocabularyForSession(terminal, 'default')).toBe(extended);
    expect(vocabularyForSession(terminal, 'gone')).toBe(extended);
    expect(vocabularyForSession(terminal, undefined)).toBe(extended);
    expect(vocabularyForSession({ backends: terminal.backends }, 'gone')).toBeUndefined();
    expect(vocabularyForSession(null, 'default')).toBeUndefined();
  });
});

test('a chord is drawn the way a menu writes it', () => {
  expect(chordGlyph('ctrl+enter')).toBe('⌃↵');
  expect(chordGlyph('shift+enter')).toBe('⇧↵');
  expect(chordGlyph('ctrl+alt+shift+left')).toBe('⌃⌥⇧←');
  expect(chordGlyph('alt+x')).toBe('⌥X');
  expect(chordGlyph('ctrl+f5')).toBe('⌃F5');
  expect(chordGlyph('ctrl+pageup')).toBe('⌃PgUp');
});

describe('isKeyUnsupportedError', () => {
  const body = '{"error":{"code":"key_unsupported","message":"tmux would deliver a bare Enter"}}';

  test('recognises the gateway refusal as the request helper throws it', () => {
    expect(isKeyUnsupportedError(new Error(`HTTP 400: ${body}`))).toBe(true);
  });

  test('needs both the 400 and the code', () => {
    expect(isKeyUnsupportedError(new Error(`HTTP 500: ${body}`))).toBe(false);
    expect(
      isKeyUnsupportedError(new Error('HTTP 400: {"error":{"code":"bad_request","message":"x"}}'))
    ).toBe(false);
    expect(isKeyUnsupportedError(new Error('HTTP 400: nope'))).toBe(false);
  });

  test("carries the gateway's message, which names the tmux fix, for the hint", () => {
    const tmux =
      '{"error":{"code":"key_unsupported","message":"\\"ctrl+enter\\" needs tmux extended keys: tmux set -s extended-keys on"}}';
    expect(keyFailureOutcome(new Error(`HTTP 400: ${tmux}`))).toEqual({
      unsupported: '"ctrl+enter" needs tmux extended keys: tmux set -s extended-keys on',
    });
    expect(keyFailureOutcome(new Error('HTTP 400: {"error":{"code":"key_unsupported"}}'))).toEqual({
      unsupported: null,
    });
    expect(keyFailureOutcome(new Error('Network request failed'))).toBe('failed');
  });

  test('ignores transport failures and non-errors', () => {
    expect(isKeyUnsupportedError(new Error('Network request failed'))).toBe(false);
    expect(isKeyUnsupportedError(undefined)).toBe(false);
  });
});

describe('paneVocabulary: the backend and the pane both have to take extended keys', () => {
  test('a pane that has not asked for extended keys narrows an extended backend', () => {
    const combined = paneVocabulary(extended, false);
    expect(combined?.extended).toBe(false);
    expect(combined?.bases).toEqual(extended.bases);
    expect(combined?.modifiers).toEqual(extended.modifiers);
    expect(allowChord('ctrl+enter', combined)).toBe(false);
    expect(allowChord('shift+enter', combined)).toBe(false);
    expect(allowChord('alt+left', combined)).toBe(false);
    // The classic set never depended on it.
    expect(allowChord('ctrl+c', combined)).toBe(true);
    expect(allowChord('ctrl+[', combined)).toBe(true);
    expect(allowChord('ctrl+space', combined)).toBe(true);
    expect(allowChord('shift+tab', combined)).toBe(true);
    expect(allowChord('enter', combined)).toBe(true);
  });

  test('a pane that has asked, or an answer without the field, changes nothing', () => {
    expect(paneVocabulary(extended, true)).toBe(extended);
    expect(paneVocabulary(extended, undefined)).toBe(extended);
    expect(allowChord('ctrl+enter', paneVocabulary(extended, undefined))).toBe(true);
  });

  test('a pane cannot widen a backend that has no extended keys', () => {
    expect(paneVocabulary(classicOnly, true)).toBe(classicOnly);
    expect(allowChord('ctrl+enter', paneVocabulary(classicOnly, true))).toBe(false);
  });

  test('no backend vocabulary stays none, so the SSH encoder still decides', () => {
    expect(paneVocabulary(undefined, false)).toBeUndefined();
    expect(paneVocabulary(undefined, true)).toBeUndefined();
  });

  test('a row sequence is deliverable when each of its keys is', () => {
    const narrowed = paneVocabulary(extended, false);
    // Claude Code's backslash-Enter needs nothing extended.
    expect(['\\', 'enter'].every((key) => allowChord(key, narrowed))).toBe(true);
    expect(['esc', 'esc'].every((key) => allowChord(key, narrowed))).toBe(true);
    expect(['\\', 'ctrl+enter'].every((key) => allowChord(key, narrowed))).toBe(false);
  });
});

describe('heldBackModifiers: the hint while a modifier is armed', () => {
  const none = { ctrl: false, alt: false, shift: false };

  test('names the armed modifiers when the pane takes no extended keys', () => {
    expect(heldBackModifiers({ ...none, ctrl: true }, classicOnly)).toBe('Ctrl');
    expect(heldBackModifiers({ ...none, alt: true }, classicOnly)).toBe('Alt');
    expect(heldBackModifiers({ ctrl: true, alt: false, shift: true }, classicOnly)).toBe(
      'Ctrl+Shift'
    );
  });

  test('shift on its own is a capital on a phone, never a hint', () => {
    expect(heldBackModifiers({ ...none, shift: true }, classicOnly)).toBeNull();
  });

  test('nothing armed, an extended pane, or no vocabulary: no hint', () => {
    expect(heldBackModifiers(none, classicOnly)).toBeNull();
    expect(heldBackModifiers({ ...none, ctrl: true }, extended)).toBeNull();
    expect(heldBackModifiers({ ...none, ctrl: true }, undefined)).toBeNull();
  });
});
