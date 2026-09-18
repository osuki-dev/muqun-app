// What the app is still allowed to know about markdown syntax.
//
// Everything the model or the engine writes is rendered by one pipeline now,
// so these three functions are the whole remaining surface where the app reads
// the syntax itself: the preview under a closed notice, the one-line labels a
// form's fields keep, and the question of whether a failure is a sentence or a
// small document. Each is pure, and each is pinned here against the shapes the
// engine actually sends.
import { describe, expect, test } from 'bun:test';

import { hasMarkdownStructure, plainFromMarkdown, strikeMarkdown } from '../markdown-text';

describe('plainFromMarkdown', () => {
  test('a heading loses its hashes and keeps its words', () => {
    expect(plainFromMarkdown('## Search')).toBe('Search');
    expect(plainFromMarkdown('###### deep')).toBe('deep');
  });

  test('list markers come off, bullets and numbers alike', () => {
    expect(plainFromMarkdown('- search(input: {…})\n- glob(pattern)')).toBe(
      'search(input: {…}) glob(pattern)'
    );
    expect(plainFromMarkdown('1. first\n2) second')).toBe('first second');
  });

  test('inline code, emphasis and links keep only their text', () => {
    expect(plainFromMarkdown('the `read` tool')).toBe('the read tool');
    expect(plainFromMarkdown('**loud** and _quiet_ and ~~gone~~')).toBe('loud and quiet and gone');
    expect(plainFromMarkdown('see [the docs](https://example.com/x)')).toBe('see the docs');
    expect(plainFromMarkdown('![a diagram](img.png)')).toBe('a diagram');
  });

  test('a quote and a rule are dropped, not shown as punctuation', () => {
    expect(plainFromMarkdown('> quoted\n\n---\n\nafter')).toBe('quoted after');
  });

  test('a fenced block is dropped whole', () => {
    expect(plainFromMarkdown('before\n\n```ts\nconst a = 1;\n```\n\nafter')).toBe('before after');
  });

  test('an unterminated fence, as a streamed note arrives, is still dropped', () => {
    expect(plainFromMarkdown('note\n\n```sh\nls -la')).toBe('note ls -la');
  });

  test('the real notice from the tool-catalog reminder reads as one line', () => {
    const notice = [
      'The Code Mode tool catalog has changed',
      '',
      '## Search',
      '',
      '- search(input: {query: string})',
      '- glob(input: {pattern: string})',
    ].join('\n');
    expect(plainFromMarkdown(notice)).toBe(
      'The Code Mode tool catalog has changed Search search(input: {query: string}) glob(input: {pattern: string})'
    );
  });

  test('plain prose is returned as it was, minus its blank lines', () => {
    expect(plainFromMarkdown('One sentence.')).toBe('One sentence.');
    expect(plainFromMarkdown('  spaced  out  ')).toBe('spaced out');
    expect(plainFromMarkdown('')).toBe('');
  });

  test('a lone asterisk or underscore is left alone', () => {
    // 2 * 3 is arithmetic, and snake_case_names are identifiers; neither is
    // emphasis, and a preview that ate the character would be lying.
    expect(plainFromMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(plainFromMarkdown('read agent_tool_output')).toBe('read agent_tool_output');
  });
});

describe('hasMarkdownStructure', () => {
  test('a one-line failure is a sentence, not a document', () => {
    expect(hasMarkdownStructure('ENOENT: no such file or directory')).toBe(false);
    expect(hasMarkdownStructure('The user declined this tool call')).toBe(false);
    expect(hasMarkdownStructure('')).toBe(false);
    expect(hasMarkdownStructure('   ')).toBe(false);
  });

  test('more than one line is shape enough', () => {
    expect(hasMarkdownStructure('failed:\n  at line 3')).toBe(true);
  });

  test('the marks a renderer would act on', () => {
    expect(hasMarkdownStructure('run `bun test` first')).toBe(true);
    expect(hasMarkdownStructure('**fatal**: out of memory')).toBe(true);
    expect(hasMarkdownStructure('see [the log](https://example.com/l)')).toBe(true);
    expect(hasMarkdownStructure('```sh')).toBe(true);
    expect(hasMarkdownStructure('$$E = mc^2$$')).toBe(true);
  });
});

describe('strikeMarkdown', () => {
  test('a finished item is wrapped so the renderer draws the rule', () => {
    expect(strikeMarkdown('Ship the card')).toBe('~~Ship the card~~');
    expect(strikeMarkdown('  padded  ')).toBe('~~padded~~');
  });

  test('inline code survives inside the strike', () => {
    expect(strikeMarkdown('fix `agent-tool-card.tsx`')).toBe('~~fix `agent-tool-card.tsx`~~');
  });

  test('anything a strike cannot span is returned untouched', () => {
    // Strikethrough is an inline span: wrapping a multi-line item, or one that
    // already holds a tilde, would show the tildes rather than the rule.
    expect(strikeMarkdown('first line\nsecond line')).toBe('first line\nsecond line');
    expect(strikeMarkdown('rename ~/notes')).toBe('rename ~/notes');
    expect(strikeMarkdown('')).toBe('');
  });
});
