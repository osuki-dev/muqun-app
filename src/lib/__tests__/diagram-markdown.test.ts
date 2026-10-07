import { expect, test } from 'bun:test';
import { splitDiagramMarkdown } from '../diagram-markdown';
test('closed Mermaid becomes a diagram and adjacent markdown stays intact', () => {
  const source = 'before\n```mermaid\nflowchart TD\nA-->B\n```\nafter';
  const parts = splitDiagramMarkdown(source);
  expect(parts.map((p) => p.markdown).join('')).toBe(source);
  expect(parts[1].source).toBe('flowchart TD\nA-->B');
});
test('streaming and ordinary code fences remain native markdown', () => {
  expect(splitDiagramMarkdown('```mermaid\nflowchart TD\nA-->')).toEqual([
    { start: 0, markdown: '```mermaid\nflowchart TD\nA-->' },
  ]);
  expect(splitDiagramMarkdown('```ts\nconst x = 1\n```')[0].source).toBeUndefined();
});
