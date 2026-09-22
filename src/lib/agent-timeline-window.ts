import type { TimelineItem } from './agent-protocol';

/**
 * Keeps a silent snapshot correction anchored to the first canonical row that
 * was visible before the replacement. A missing anchor falls back to the
 * newest history page.
 */
export function windowStartForSnapshot(
  previous: readonly TimelineItem[],
  previousWindowStart: number,
  next: readonly TimelineItem[],
  pageSize: number
): number {
  const anchorId = previous[previousWindowStart]?.id;
  const anchorIndex = anchorId ? next.findIndex((item) => item.id === anchorId) : -1;
  return anchorIndex >= 0 ? anchorIndex : Math.max(0, next.length - pageSize);
}
