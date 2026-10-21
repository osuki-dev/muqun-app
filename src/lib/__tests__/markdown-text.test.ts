import { expect, test } from 'bun:test';

import { inlineMarkdownSpans, plainFromMarkdown } from '../markdown-text';

test('inline marks become spans and block syntax goes', () => {
  expect(
    inlineMarkdownSpans('## Running **tests** in `src/lib`, *then* [docs](https://x.dev)')
  ).toEqual([
    { text: 'Running ' },
    { text: 'tests', mark: 'strong' },
    { text: ' in ' },
    { text: 'src/lib', mark: 'code' },
    { text: ', ' },
    { text: 'then', mark: 'emphasis' },
    { text: ' docs' },
  ]);
});

test('identifiers, arithmetic and unclosed marks stay as written', () => {
  for (const line of ['read agent_tool_output now', '2 * 3 * 4', 'half **open', 'a `tick']) {
    expect(inlineMarkdownSpans(line)).toEqual([{ text: line }]);
  }
});

test('code bodies are never read as emphasis', () => {
  expect(inlineMarkdownSpans('`*args*` and __init__')).toEqual([
    { text: '*args*', mark: 'code' },
    { text: ' and ' },
    { text: 'init', mark: 'strong' },
  ]);
});

test('the spans read the same as the plain preview', () => {
  const line = '- **Edit** `a.ts`: _fix_ the ~~old~~ path';
  expect(
    inlineMarkdownSpans(line)
      .map((span) => span.text)
      .join('')
  ).toBe(plainFromMarkdown(line));
});
