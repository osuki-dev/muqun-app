import { describe, expect, test } from 'bun:test';
import { changeKeyboardLayout, resolveKeyboardInput } from '../virtual-keyboard-input';
import { keyboardCombinationKeys, terminalKeysForPane, withEditorActions } from '../terminal-keys';
import { encodeTerminalKey, encodeTerminalKeySequence } from '../ssh-key-bytes';

const plain = { shift: false, ctrl: false, alt: false };

describe('raw keyboard input', () => {
  test('letters and punctuation remain exact text without implicit Enter', () => {
    for (let code = 32; code < 127; code++) {
      const text = String.fromCharCode(code);
      expect(resolveKeyboardInput(text, 'character', plain)).toEqual({ text });
    }
    expect(resolveKeyboardInput('q', 'character', { ...plain, shift: true })).toEqual({
      text: 'Q',
    });
  });

  test('every control letter resolves to its actual control byte', () => {
    for (let code = 97; code <= 122; code++) {
      const input = resolveKeyboardInput(String.fromCharCode(code), 'character', {
        ...plain,
        ctrl: true,
      });
      expect(input).toEqual({ key: `ctrl+${String.fromCharCode(code)}` });
      if (input && 'key' in input)
        expect(Array.from(encodeTerminalKey(input.key)!)).toEqual([code - 96]);
    }
  });

  test('modifiers apply to navigation, Tab and Space; Escape remains an escape', () => {
    expect(resolveKeyboardInput('tab', 'key', { ...plain, shift: true })).toEqual({
      key: 'shift+tab',
    });
    expect(resolveKeyboardInput(' ', 'character', { ...plain, ctrl: true })).toEqual({
      key: 'ctrl+space',
    });
    for (const key of ['left', 'down', 'up', 'right']) {
      expect(resolveKeyboardInput(key, 'key', { ...plain, alt: true })).toEqual({
        key: `alt+${key}`,
      });
    }
    expect(resolveKeyboardInput('esc', 'key', { shift: true, ctrl: true, alt: true })).toEqual({
      key: 'esc',
    });
    expect(resolveKeyboardInput('!', 'character', { ...plain, ctrl: true })).toBeNull();
  });
});

describe('one shortcut strip shared with nvim', () => {
  test('complete combinations replace duplicate bare keys in the full keyboard only', () => {
    const compact = terminalKeysForPane('codex');
    const full = keyboardCombinationKeys(compact);
    expect(compact.some((key) => key.key === 'enter')).toBe(true);
    expect(full.some((key) => key.key === 'enter')).toBe(false);
    expect(full.some((key) => key.key === 'esc')).toBe(false);
    expect(new Set(full.map((key) => key.key)).size).toBe(full.length);
    for (const key of ['shift+tab', 'ctrl+c', 'alt+left', 'alt+down', 'alt+up', 'alt+right']) {
      expect(full.some((item) => item.key === key)).toBe(true);
    }
    expect(full.find((key) => key.key === 'sequence:escape')?.keys).toEqual(['esc', 'esc']);
  });

  test('nvim macros retain their text, leader spaces and submit semantics in the same row', () => {
    const editor = withEditorActions(terminalKeysForPane(null, 'nvim'));
    const full = keyboardCombinationKeys(editor);
    for (const key of editor.filter((item) => item.text !== undefined)) {
      expect(full.find((item) => item.key === key.key)).toBe(key);
    }
    expect(full.find((key) => key.key === 'nvim:leader:ff')?.text).toBe(' ff');
    expect(full.find((key) => key.key === 'nvim:w')?.submit).toBe(true);
  });
});

test('SSH key sequences are ordered and rejected as a whole before dispatch', () => {
  expect(Array.from(encodeTerminalKeySequence(['esc', 'esc'])!)).toEqual([27, 27]);
  expect(
    Array.from(encodeTerminalKeySequence(['esc', 'left'], { applicationCursorKeys: true })!)
  ).toEqual([27, 27, 79, 68]);
  expect(encodeTerminalKeySequence(['esc', 'invalid-key-name'])).toBeNull();
});

test('modified navigation and function keys retain Shift with Ctrl and Alt', () => {
  for (const [key, final] of [
    ['up', 'A'],
    ['down', 'B'],
    ['right', 'C'],
    ['left', 'D'],
    ['f1', 'P'],
  ]) {
    for (const [alt, parameter] of [
      [false, 6],
      [true, 8],
    ] as const) {
      const input = resolveKeyboardInput(key, 'key', { ctrl: true, shift: true, alt });
      expect(input).toEqual({ key: `ctrl+${alt ? 'alt+' : ''}shift+${key}` });
      if (input && 'key' in input) {
        const expected = Array.from(`\x1b[1;${parameter}${final}`, (char) => char.charCodeAt(0));
        expect(Array.from(encodeTerminalKey(input.key)!)).toEqual(expected);
      }
    }
  }
  const letter = resolveKeyboardInput('w', 'character', { ctrl: true, shift: true, alt: false });
  expect(letter).toEqual({ key: 'ctrl+shift+w' });
  if (letter && 'key' in letter) expect(Array.from(encodeTerminalKey(letter.key)!)).toEqual([23]);
});

test('symbol pages do not arm Shift or consume the selected page', () => {
  const letters = { symbols: false, moreSymbols: false, shift: false };
  const shifted = changeKeyboardLayout(letters, 'shift');
  expect(shifted.shift).toBe(true);
  const symbols = changeKeyboardLayout(shifted, 'symbols');
  expect(symbols).toEqual({ symbols: true, moreSymbols: false, shift: false });
  const more = changeKeyboardLayout(symbols, 'shift');
  expect(more).toEqual({ symbols: true, moreSymbols: true, shift: false });
  expect(resolveKeyboardInput('tab', 'key', { ...plain, shift: more.shift })).toEqual({
    key: 'tab',
  });
  expect(resolveKeyboardInput('up', 'key', { ...plain, ctrl: true, shift: more.shift })).toEqual({
    key: 'ctrl+up',
  });
  expect(changeKeyboardLayout(more, 'consume')).toEqual(more);
  expect(changeKeyboardLayout(more, 'symbols')).toEqual(letters);
});
