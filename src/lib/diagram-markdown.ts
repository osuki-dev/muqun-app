import { findMermaidFences } from '@osuki-dev/skia-diagrams';
export interface DiagramMarkdownPart {
  start: number;
  markdown: string;
  source?: string;
}
/** Open fences remain markdown: never render a partial streaming diagram. */
export function splitDiagramMarkdown(markdown: string): DiagramMarkdownPart[] {
  if (!/mermaid/i.test(markdown)) return [{ start: 0, markdown }];
  const parts: DiagramMarkdownPart[] = [];
  let cursor = 0;
  for (const fence of findMermaidFences(markdown)) {
    if (!fence.closed) continue;
    if (fence.start > cursor)
      parts.push({ start: cursor, markdown: markdown.slice(cursor, fence.start) });
    parts.push({
      start: fence.start,
      markdown: markdown.slice(fence.start, fence.end),
      source: fence.source,
    });
    cursor = fence.end;
  }
  if (cursor < markdown.length || !parts.length)
    parts.push({ start: cursor, markdown: markdown.slice(cursor) });
  return parts;
}
