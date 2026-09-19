import { describe, expect, test } from 'bun:test';

import {
  MARKDOWN_CHUNK_CHARS,
  TOOL_BODY_MAX_LINES,
  capBodyLines,
  capMarkdown,
  capToolBody,
} from '../markdown-cap';

describe('capMarkdown', () => {
  test('a short document is handed over whole', () => {
    const doc = '# Title\n\nA paragraph.';
    expect(capMarkdown(doc)).toEqual({ text: doc, hidden: 0 });
  });

  test('a long document is cut at a line boundary', () => {
    const doc = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n');
    const capped = capMarkdown(doc, 1000);
    expect(capped.text.length).toBeLessThanOrEqual(1000);
    expect(capped.text.endsWith('\n')).toBe(false);
    expect(capped.hidden).toBe(doc.length - capped.text.length);
  });

  test('one enormous line still yields something', () => {
    const doc = 'x'.repeat(5000);
    const capped = capMarkdown(doc, 1000);
    expect(capped.text.length).toBe(1000);
    expect(capped.hidden).toBe(4000);
  });

  test('a cut inside a fence closes the fence', () => {
    const doc = ['```python', ...Array.from({ length: 400 }, (_, i) => `x${i} = ${i}`), '```'].join(
      '\n'
    );
    const capped = capMarkdown(doc, 200);
    expect(capped.hidden).toBeGreaterThan(0);
    expect(capped.text.endsWith('```')).toBe(true);
  });

  test('the default budget is the chunk size', () => {
    const doc = 'a\n'.repeat(MARKDOWN_CHUNK_CHARS);
    expect(capMarkdown(doc).text.length).toBeLessThanOrEqual(MARKDOWN_CHUNK_CHARS);
  });
});

describe('capBodyLines', () => {
  test('counts the lines it held back', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `x${i}=${i}`).join('\n');
    const capped = capBodyLines(body, 400);
    expect(capped.text.split('\n')).toHaveLength(400);
    expect(capped.hidden).toBe(4600);
  });

  test('an empty body is not a cut', () => {
    expect(capBodyLines('')).toEqual({ text: '', hidden: 0 });
  });
});

describe('capToolBody', () => {
  test('lines first, then characters', () => {
    // Four hundred lines that are each 1 KB: inside the line cap, far outside
    // the character ceiling.
    const body = Array.from({ length: 800 }, () => 'y'.repeat(1000)).join('\n');
    const capped = capToolBody(body, TOOL_BODY_MAX_LINES, 10_000);
    expect(capped.text.length).toBeLessThanOrEqual(10_000);
    // Everything the line cap held back, plus everything the character cap did.
    expect(capped.hidden).toBeGreaterThan(400);
  });

  test('a body inside both caps is untouched', () => {
    const body = 'one\ntwo\nthree';
    expect(capToolBody(body)).toEqual({ text: body, hidden: 0 });
  });
});
