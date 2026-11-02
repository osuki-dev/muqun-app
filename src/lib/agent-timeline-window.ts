import type { TimelineItem } from './agent-protocol';
import { drawnRowKey } from './agent-timeline-upsert';

/**
 * Keeps a silent snapshot correction anchored to the first canonical row that
 * was visible before the replacement. A missing anchor falls back to the
 * newest history page.
 *
 * The anchor is the row as drawn, not its id: a replacement can re-id a row
 * it carries the key of (`carryDrawnRowKeys`), and the reader's page must
 * not jump to the newest one over that.
 */
export function windowStartForSnapshot(
  previous: readonly TimelineItem[],
  previousWindowStart: number,
  next: readonly TimelineItem[],
  pageSize: number
): number {
  const anchor = previous[previousWindowStart];
  const anchorKey = anchor ? drawnRowKey(anchor) : undefined;
  const anchorIndex = anchorKey ? next.findIndex((item) => drawnRowKey(item) === anchorKey) : -1;
  return anchorIndex >= 0 ? anchorIndex : Math.max(0, next.length - pageSize);
}
