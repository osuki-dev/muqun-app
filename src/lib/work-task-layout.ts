/** Pane widths are safe content widths, after route insets and outer gutters. */
export function workTaskPaneMetrics(width: number, fontScale: number) {
  const scale = Math.max(1, Number.isFinite(fontScale) ? fontScale : 1);
  const list = 320 * scale;
  const detail = 480 * scale;
  return { split: Number.isFinite(width) && width >= list + 24 + detail, list, detail, gap: 24 };
}

export function workTaskDockLimit(viewport: number, keyboardHeight: number) {
  const available = Math.max(0, viewport - Math.max(0, keyboardHeight));
  return Math.max(0, available * 0.6);
}

export interface WorkLayoutAnchor {
  id: string;
  offset: number;
  raw: number;
}
export function captureWorkLayoutAnchor(
  offset: number,
  sections: ReadonlyMap<string, number>
): WorkLayoutAnchor {
  offset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  let id = '';
  let top = 0;
  for (const [key, y] of sections)
    if (y <= offset && y >= top) {
      id = key;
      top = y;
    }
  return { id, offset: offset - top, raw: offset };
}
export function restoreWorkLayoutAnchor(
  anchor: WorkLayoutAnchor,
  sections: ReadonlyMap<string, number>,
  content: number,
  viewport: number,
  dragging: boolean
): number | null {
  if (dragging) return null;
  const top = sections.get(anchor.id);
  const desired = top === undefined ? anchor.raw : top + anchor.offset;
  return Math.max(
    0,
    Math.min(Number.isFinite(desired) ? desired : 0, Math.max(0, content - viewport))
  );
}
