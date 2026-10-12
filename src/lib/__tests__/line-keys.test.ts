import { describe, expect, test } from 'bun:test';

import { keyedLines } from '../line-keys';

describe('keyedLines', () => {
  test('keys are unique even when lines repeat', () => {
    const lines = keyedLines('+ a\n+ b\n+ a\n');
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  test('keys are stable for the same text', () => {
    const text = 'context\n-was\n+is\ncontext\n';
    expect(keyedLines(text).map((l) => l.key)).toEqual(keyedLines(text).map((l) => l.key));
  });

  test('lines come back verbatim, blank lines included', () => {
    const lines = keyedLines('a\n\nb');
    expect(lines.map((l) => l.line)).toEqual(['a', '', 'b']);
  });
});
