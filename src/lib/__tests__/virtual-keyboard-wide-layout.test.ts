import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { paneVocabulary, type KeyboardVocabulary } from '../key-vocabulary';
import {
  DOUBLE_TAP_MS,
  MAIN_UNITS,
  NAV_UNITS,
  SHIFTED_CHARACTERS,
  consumeModifier,
  resolveWideKey,
  rowUnits,
  shiftedCharacter,
  tapModifier,
  wideKeyEnabled,
  wideKeyboardRows,
  type WideKey,
} from '../virtual-keyboard-layout';

const vocabulary: KeyboardVocabulary = {
  version: 1,
  bases: [
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
  ],
  modifiers: ['ctrl', 'alt', 'shift'],
  extended: true,
};
const classicOnly = { ...vocabulary, extended: false };
const none = { ctrl: false, alt: false, shift: false };
const ctrl = { ...none, ctrl: true };

const rows = wideKeyboardRows(true);
const allKeys = rows.flatMap((row) => [...row.main, ...row.nav]);
function find(id: string): WideKey {
  const item = allKeys.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`no key ${id}`);
  return item;
}

describe('geometry', () => {
  test('every row is a 15u main block and a 3u navigation column', () => {
    expect(MAIN_UNITS).toBe(15);
    expect(NAV_UNITS).toBe(3);
    for (const row of rows) {
      expect(rowUnits(row.main)).toBeCloseTo(MAIN_UNITS, 5);
      expect(rowUnits(row.nav)).toBeCloseTo(NAV_UNITS, 5);
    }
  });

  test('the rows are the ones a keyboard has, in order', () => {
    expect(rows.map((row) => row.id)).toEqual([
      'function',
      'number',
      'top',
      'home',
      'bottom',
      'space',
    ]);
    expect(wideKeyboardRows(false).map((row) => row.id)).toEqual([
      'number',
      'top',
      'home',
      'bottom',
      'space',
    ]);
    const values = (id: string) =>
      rows
        .find((row) => row.id === id)!
        .main.filter((item) => item.kind !== 'spacer')
        .map((item) => item.value);
    expect(values('function')).toEqual([
      'esc',
      ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
    ]);
    expect(values('number')).toEqual([...'`1234567890-=', 'backspace']);
    expect(values('top')).toEqual(['tab', ...'qwertyuiop[]\\']);
    expect(values('home')).toEqual(['ctrl', ..."asdfghjkl;'", 'enter']);
    expect(values('bottom')).toEqual(['shift', ...'zxcvbnm,./', 'shift']);
    expect(values('space')).toEqual(['alt', ' ', 'alt']);
  });

  test('home, end, page up and page down sit over an inverted T', () => {
    const nav = rows.map((row) => row.nav.map((item) => item.value));
    expect(nav).toEqual([
      ['insert', 'delete'],
      ['fn', 'hide'],
      ['home', 'end'],
      ['pageup', 'pagedown'],
      ['', 'up', ''],
      ['left', 'down', 'right'],
    ]);
    // The up arrow is centred over down.
    const up = rows[4].nav;
    expect(up[0].units).toBe(up[2].units);
  });

  test('ids are unique, so React keys and test ids are too', () => {
    expect(new Set(allKeys.map((item) => item.id)).size).toBe(allKeys.length);
  });

  test('the controls survive hiding the strip', () => {
    const hidden = wideKeyboardRows(false).flatMap((row) => row.nav.map((item) => item.value));
    expect(hidden).toContain('hide');
    expect(hidden).toContain('fn');
  });
});

describe('shift', () => {
  test('symbols come from the table, letters from their capital', () => {
    expect(Object.keys(SHIFTED_CHARACTERS)).toHaveLength(21);
    expect(shiftedCharacter('1')).toBe('!');
    expect(shiftedCharacter('`')).toBe('~');
    expect(shiftedCharacter('\\')).toBe('|');
    expect(shiftedCharacter("'")).toBe('"');
    expect(shiftedCharacter('q')).toBe('Q');
    expect(find('char-2').shiftLabel).toBe('@');
    expect(find('char-a').shiftLabel).toBe('A');
    expect(find('char-space').shiftLabel).toBeUndefined();
  });

  test('every character key on the layout types its shifted face with shift armed', () => {
    for (const item of allKeys.filter((candidate) => candidate.kind === 'char')) {
      expect(resolveWideKey(item, { ...none, shift: true }, vocabulary)).toEqual({
        text: item.shiftLabel ?? item.value,
      });
      expect(resolveWideKey(item, none, vocabulary)).toEqual({
        text: item.value,
      });
    }
  });
});

describe('what a key sends', () => {
  test('ctrl armed then enter is ctrl+enter on an extended backend', () => {
    expect(resolveWideKey(find('key-enter'), ctrl, vocabulary)).toEqual({
      key: 'ctrl+enter',
    });
    expect(resolveWideKey(find('key-enter'), { ...none, shift: true }, vocabulary)).toEqual({
      key: 'shift+enter',
    });
    expect(resolveWideKey(find('char-x'), { ...none, alt: true }, vocabulary)).toEqual({
      key: 'alt+x',
    });
    expect(resolveWideKey(find('key-f5'), none, vocabulary)).toEqual({
      key: 'f5',
    });
    expect(resolveWideKey(find('char-space'), ctrl, classicOnly)).toEqual({
      key: 'ctrl+space',
    });
    expect(resolveWideKey(find('char-c'), ctrl, classicOnly)).toEqual({
      key: 'ctrl+c',
    });
  });

  test('modifiers and controls send nothing', () => {
    expect(resolveWideKey(find('mod-ctrl-left'), none, vocabulary)).toBeNull();
    expect(resolveWideKey(find('control-hide'), none, vocabulary)).toBeNull();
  });
});

describe('which keys are muted', () => {
  test('with nothing armed, every key is live under any vocabulary', () => {
    for (const vocab of [vocabulary, classicOnly, undefined]) {
      for (const item of allKeys) expect(wideKeyEnabled(item, none, vocab)).toBe(true);
    }
  });

  test('ctrl on a classic-only backend leaves the classic chords and esc', () => {
    const live = allKeys
      .filter((item) => item.kind === 'char' || item.kind === 'key')
      .filter((item) => wideKeyEnabled(item, ctrl, classicOnly))
      .map((item) => item.value);
    expect(live.sort()).toEqual(
      ['esc', ' ', '[', ']', '\\', ...'abcdefghijklmnopqrstuvwxyz'].sort()
    );
  });

  test('ctrl on an extended backend leaves only symbols and digits outside the vocabulary out', () => {
    const muted = allKeys
      .filter((item) => !wideKeyEnabled(item, ctrl, vocabulary))
      .map((item) => item.value);
    // Every printable character is a base under `extended`, so nothing is muted.
    expect(muted).toEqual([]);
  });

  test('a backend that cannot take alt mutes every key but esc while alt is armed', () => {
    const noAlt = { ...vocabulary, modifiers: ['ctrl', 'shift'] };
    const live = allKeys
      .filter((item) => item.kind === 'char' || item.kind === 'key')
      .filter((item) => wideKeyEnabled(item, { ...none, alt: true }, noAlt))
      .map((item) => item.value);
    expect(live).toEqual(['esc']);
  });

  test('without a vocabulary the SSH encoder decides: ctrl+enter is muted', () => {
    expect(wideKeyEnabled(find('key-enter'), ctrl, undefined)).toBe(false);
    expect(wideKeyEnabled(find('key-up'), ctrl, undefined)).toBe(true);
  });
});

describe('a pane that has not asked for extended keys', () => {
  // An extended tmux, but the program in this pane never enabled extended keys.
  const plainPane = paneVocabulary(vocabulary, false);
  const live = (modifiers: typeof none) =>
    allKeys
      .filter((item) => item.kind === 'char' || item.kind === 'key')
      .filter((item) => wideKeyEnabled(item, modifiers, plainPane))
      .map((item) => item.id)
      .sort();

  test('ctrl armed: the classic chords and esc stay, enter and the rest are disabled', () => {
    expect(live(ctrl)).toEqual(
      [
        'key-esc',
        'char-space',
        'char-[',
        'char-]',
        'char-\\',
        ...Array.from('abcdefghijklmnopqrstuvwxyz', (letter) => `char-${letter}`),
      ].sort()
    );
    expect(wideKeyEnabled(find('key-enter'), ctrl, plainPane)).toBe(false);
    expect(wideKeyEnabled(find('char-c'), ctrl, plainPane)).toBe(true);
  });

  test('shift armed: characters still type, special keys but shift+tab are disabled', () => {
    const shift = { ...none, shift: true };
    const disabled = allKeys
      .filter((item) => item.kind === 'key')
      .filter((item) => !wideKeyEnabled(item, shift, plainPane))
      .map((item) => item.value)
      .sort();
    expect(disabled).toEqual(
      [
        'backspace',
        'enter',
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
      ].sort()
    );
    expect(
      allKeys
        .filter((item) => item.kind === 'char')
        .every((item) => wideKeyEnabled(item, shift, plainPane))
    ).toBe(true);
  });

  test('alt armed: only esc is left', () => {
    expect(live({ ...none, alt: true })).toEqual(['key-esc']);
  });

  test('nothing armed: every key is live, and the same pane extended mutes nothing under ctrl', () => {
    expect(live(none).length).toBe(
      allKeys.filter((item) => item.kind === 'char' || item.kind === 'key').length
    );
    const extendedPane = paneVocabulary(vocabulary, true);
    expect(allKeys.every((item) => wideKeyEnabled(item, ctrl, extendedPane))).toBe(true);
  });
});

describe('sticky modifiers', () => {
  test('one tap holds for one key; a double tap locks until tapped again', () => {
    expect(tapModifier('off', 10_000)).toBe('once');
    expect(tapModifier('once', DOUBLE_TAP_MS)).toBe('locked');
    expect(tapModifier('once', DOUBLE_TAP_MS + 1)).toBe('off');
    expect(tapModifier('locked', 0)).toBe('off');
    expect(consumeModifier('once')).toBe('off');
    expect(consumeModifier('locked')).toBe('locked');
    expect(consumeModifier('off')).toBe('off');
  });
  test('a refused chord spends a one-shot ctrl, so the next letter is a letter', () => {
    // iOS pass: ⌃↵ on a pane without extended keys did nothing, ctrl stayed
    // armed, and the next `a` went out as ^A.
    expect(resolveWideKey(find('key-enter'), ctrl, classicOnly)).toBeNull();
    const after = consumeModifier('once');
    expect(after).toBe('off');
    expect(resolveWideKey(find('char-a'), { ...none, ctrl: after !== 'off' }, classicOnly)).toEqual(
      { text: 'a' }
    );
    // A double-tap lock is the reader asking for ctrl to stay; a refusal does
    // not override that.
    expect(consumeModifier('locked')).toBe('locked');
  });

  test('the keyboard spends modifiers on a refusal too, and keeps muted keys pressable', () => {
    const source = readFileSync('src/components/virtual-keyboard.tsx', 'utf8');
    const send = source.match(/function send\(input[\s\S]*?\n {2}\}\n/)?.[0] ?? '';
    expect(send).toContain('flagRefused(chord);');
    expect(send).toContain('setCtrlState(consumeModifier);');
    // No early return between the refusal and the spend.
    expect(send.slice(send.indexOf('if (!input)'), send.indexOf('setCtrlState'))).not.toContain(
      'return;'
    );
    expect(source).not.toContain('muted && heldBack');
  });
});
