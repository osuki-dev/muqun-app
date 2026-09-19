import { describe, expect, test } from 'bun:test';

import { MARKDOWN_BLOCK_CHUNK_CHARS, splitMarkdownBlocks } from '../markdown-blocks';

/** The invariant behind the whole viewer: the cells are the document again. */
function rejoins(markdown: string, target?: number) {
  return splitMarkdownBlocks(markdown, target).join('\n') === markdown;
}

describe('splitMarkdownBlocks', () => {
  test('an empty document has no cells', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
  });

  test('a short document is one cell', () => {
    const doc = '# Title\n\nA paragraph.\n';
    expect(splitMarkdownBlocks(doc)).toEqual([doc]);
  });

  test('a long document is many cells that rejoin to the original', () => {
    const doc = Array.from({ length: 600 }, (_, i) => `Paragraph ${i}.\n`).join('\n');
    const chunks = splitMarkdownBlocks(doc, 500);
    expect(chunks.length).toBeGreaterThan(10);
    expect(rejoins(doc, 500)).toBe(true);
  });

  test('a fence is never cut, however far past the target it runs', () => {
    const body = Array.from({ length: 400 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const doc = `Intro.\n\n\`\`\`ts\n${body}\n\`\`\`\n\nOutro.\n`;
    const chunks = splitMarkdownBlocks(doc, 200);
    const fenced = chunks.filter((chunk) => chunk.includes('```'));
    // One cell holds both markers; no cell holds an odd number of them.
    expect(fenced).toHaveLength(1);
    for (const chunk of chunks) {
      expect((chunk.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? []).length % 2).toBe(0);
    }
    expect(rejoins(doc, 200)).toBe(true);
  });

  test('a fence is closed by its own marker and not by a shorter one inside it', () => {
    const doc = ['````md', 'Nested:', '```ts', 'const a = 1;', '```', '````', '', 'After.'].join(
      '\n'
    );
    const chunks = splitMarkdownBlocks(doc, 20);
    expect(chunks[0]).toContain('````md');
    expect(chunks[0]).toContain('````\n');
    expect(chunks[chunks.length - 1]).toContain('After.');
    expect(rejoins(doc, 20)).toBe(true);
  });

  test('blank lines inside a fence do not end the cell', () => {
    const doc = ['```', 'one', '', 'two', '', 'three', '```', '', 'Text.'].join('\n');
    const chunks = splitMarkdownBlocks(doc, 10);
    expect(chunks[0]).toBe('```\none\n\ntwo\n\nthree\n```\n');
    expect(rejoins(doc, 10)).toBe(true);
  });

  test('an unclosed fence runs to the end, the way the parser reads it', () => {
    const doc = 'Intro.\n\n```ts\nconst a = 1;\nconst b = 2;\n';
    const chunks = splitMarkdownBlocks(doc, 10);
    expect(chunks[chunks.length - 1]).toBe('```ts\nconst a = 1;\nconst b = 2;\n');
    expect(rejoins(doc, 10)).toBe(true);
  });

  test('a table stays in one cell', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `| cell ${i} | value ${i} |`).join('\n');
    const doc = `| a | b |\n| --- | --- |\n${rows}\n\nAfter.\n`;
    const chunks = splitMarkdownBlocks(doc, 100);
    const withPipes = chunks.filter((chunk) => chunk.includes('|'));
    expect(withPipes).toHaveLength(1);
    expect(withPipes[0]).toContain('| --- | --- |');
    expect(withPipes[0]).toContain('| cell 59 | value 59 |');
    expect(rejoins(doc, 100)).toBe(true);
  });

  test('a loose list is not cut between its items, so numbering survives', () => {
    const items = Array.from({ length: 40 }, (_, i) => `${i + 1}. Item ${i + 1}`).join('\n\n');
    const doc = `Intro.\n\n${items}\n\nAfter.\n`;
    const chunks = splitMarkdownBlocks(doc, 80);
    const listed = chunks.filter((chunk) => /^\d+\. /m.test(chunk));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain('1. Item 1');
    expect(listed[0]).toContain('40. Item 40');
    expect(rejoins(doc, 80)).toBe(true);
  });

  test('an indented continuation keeps a list together', () => {
    const doc = ['- one', '', '  continued', '', '- two', '', 'A paragraph.'].join('\n');
    const chunks = splitMarkdownBlocks(doc, 10);
    expect(chunks[0]).toBe('- one\n\n  continued\n\n- two\n');
    expect(chunks[1]).toBe('A paragraph.');
    expect(rejoins(doc, 10)).toBe(true);
  });

  test('a heading is not left alone at the foot of a cell', () => {
    const doc = ['Paragraph one.', '', '## Section', '', 'Paragraph two.', ''].join('\n');
    const chunks = splitMarkdownBlocks(doc, 20);
    for (const chunk of chunks) {
      if (chunk.includes('## Section')) expect(chunk).toContain('Paragraph two.');
    }
    expect(rejoins(doc, 20)).toBe(true);
  });

  test('an atom larger than the target is its own cell rather than being cut', () => {
    const doc = `${'word '.repeat(2_000)}\n\nAfter.\n`;
    const chunks = splitMarkdownBlocks(doc, 100);
    expect(chunks[0].length).toBeGreaterThan(100);
    expect(chunks[chunks.length - 1]).toContain('After.');
    expect(rejoins(doc, 100)).toBe(true);
  });

  test('the default target keeps a cell inside what BoundedMarkdown draws whole', () => {
    const doc = Array.from({ length: 4_000 }, (_, i) => `Paragraph ${i}.\n`).join('\n');
    const chunks = splitMarkdownBlocks(doc);
    for (const chunk of chunks) {
      // Every atom here is small, so nothing forces a cell past the target.
      expect(chunk.length).toBeLessThanOrEqual(MARKDOWN_BLOCK_CHUNK_CHARS);
    }
    expect(rejoins(doc)).toBe(true);
  });

  test('a document of blank lines rejoins', () => {
    expect(rejoins('\n\n\n\n', 2)).toBe(true);
  });

  test('a document with no trailing newline rejoins', () => {
    expect(rejoins('# A\n\nbody\n\n# B\n\nbody', 10)).toBe(true);
  });
});
