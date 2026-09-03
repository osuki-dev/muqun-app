/**
 * The composer's submit rule for an SSH shell: a line and its Enter, a paste
 * and its markers.
 */
import { describe, expect, test } from 'bun:test';

import { composerSubmitBytes, composerSubmitText } from '@/lib/ssh-composer';

describe('composerSubmitText', () => {
  test('one line is sent as typed, followed by a carriage return', () => {
    expect(composerSubmitText('hello', { bracketedPaste: false })).toBe('hello\r');
    expect(composerSubmitText('hello', { bracketedPaste: true })).toBe('hello\r');
  });

  test('an empty draft still submits: Enter on an empty prompt is a line', () => {
    expect(composerSubmitText('', { bracketedPaste: false })).toBe('\r');
  });

  test('a multi-line draft is typed with \\r line ends when the far side has not asked for pastes', () => {
    expect(composerSubmitText('one\ntwo', { bracketedPaste: false })).toBe('one\rtwo\r');
  });

  test('a multi-line draft is wrapped in paste markers when bracketed paste is on', () => {
    expect(composerSubmitText('one\ntwo', { bracketedPaste: true })).toBe(
      '\x1b[200~one\rtwo\x1b[201~\r'
    );
  });

  test('CRLF and lone CR line ends are one spelling before the rule', () => {
    expect(composerSubmitText('one\r\ntwo\rthree', { bracketedPaste: false })).toBe(
      'one\rtwo\rthree\r'
    );
    expect(composerSubmitText('one\r\ntwo', { bracketedPaste: true })).toBe(
      '\x1b[200~one\rtwo\x1b[201~\r'
    );
  });

  test('a trailing newline in a paste stays inside the block, and the submit follows it', () => {
    expect(composerSubmitText('one\n', { bracketedPaste: true })).toBe('\x1b[200~one\r\x1b[201~\r');
  });

  test('an editor gets the text and no Enter, with or without paste markers', () => {
    expect(composerSubmitText('hello', { bracketedPaste: false, enter: false })).toBe('hello');
    expect(composerSubmitText('one\ntwo', { bracketedPaste: false, enter: false })).toBe(
      'one\rtwo'
    );
    expect(composerSubmitText('one\ntwo', { bracketedPaste: true, enter: false })).toBe(
      '\x1b[200~one\rtwo\x1b[201~'
    );
  });
});

describe('composerSubmitBytes', () => {
  test('is the submit text as UTF-8', () => {
    expect(Array.from(composerSubmitBytes('hi', { bracketedPaste: false }))).toEqual([
      0x68, 0x69, 0x0d,
    ]);
    expect(Array.from(composerSubmitBytes('é', { bracketedPaste: false }))).toEqual([
      0xc3, 0xa9, 0x0d,
    ]);
  });
});
