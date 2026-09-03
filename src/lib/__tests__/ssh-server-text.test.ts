import { describe, expect, test } from 'bun:test';

import { SERVER_TEXT_LIMIT, sanitizeServerText, sshFailureLine } from '@/lib/ssh-server-text';

describe('sanitizeServerText', () => {
  test('ordinary text passes through, trimmed', () => {
    expect(sanitizeServerText('  Enter your one-time code:  ')).toBe('Enter your one-time code:');
    expect(sanitizeServerText('Bienvenue — 欢迎 — مرحبا')).toBe('Bienvenue — 欢迎 — مرحبا');
  });

  test('anything that is not a string is nothing', () => {
    expect(sanitizeServerText(undefined)).toBe('');
    expect(sanitizeServerText(null)).toBe('');
    expect(sanitizeServerText(42)).toBe('');
    expect(sanitizeServerText({ toString: () => 'x' })).toBe('');
  });

  test('control characters are removed', () => {
    expect(sanitizeServerText('a\x00b\x07c\x1b[31md\x7fe\x9bf')).toBe('abc[31mdef');
  });

  test('line breaks are kept as plain newlines and tabs become spaces', () => {
    expect(sanitizeServerText('one\r\ntwo\rthree four\tfive')).toBe('one\ntwo\nthree\nfour five');
  });

  test('bidi overrides, isolates and zero-width characters are removed', () => {
    expect(sanitizeServerText('safe‮txt.exe')).toBe('safetxt.exe');
    expect(sanitizeServerText('a⁦b⁩c​d‍e﻿f­g')).toBe('abcdefg');
  });

  test('a long text is cut at the limit with an ellipsis', () => {
    const out = sanitizeServerText('x'.repeat(2000));
    expect(out).toHaveLength(SERVER_TEXT_LIMIT);
    expect(out.endsWith('…')).toBe(true);
    expect(sanitizeServerText('abcdef', 4)).toBe('abc…');
  });

  test('the limit counts characters, not code units, so a surrogate pair is never split', () => {
    expect(sanitizeServerText('😀😀😀😀', 4)).toBe('😀😀😀😀');
    expect(sanitizeServerText('😀😀😀😀😀', 4)).toBe('😀😀😀…');
  });

  test('a message made only of what is stripped is empty', () => {
    expect(sanitizeServerText('\x1b\x1b\x07 ‮ ')).toBe('');
  });
});

describe('sshFailureLine', () => {
  test('is the code and the cleaned message', () => {
    expect(sshFailureLine({ code: 'AUTH_FAILED', message: 'no more methods\r\n\x1b[2J' })).toBe(
      'AUTH_FAILED: no more methods\n[2J'
    );
  });

  test('is the code alone when the message is empty or all noise', () => {
    expect(sshFailureLine({ code: 'TIMEOUT', message: '' })).toBe('TIMEOUT');
    expect(sshFailureLine({ code: 'TIMEOUT', message: '\x07\x00' })).toBe('TIMEOUT');
  });

  test('a message the size of a page is cut', () => {
    expect(sshFailureLine({ code: 'IO', message: 'm'.repeat(5000) }).length).toBeLessThan(200);
  });
});
