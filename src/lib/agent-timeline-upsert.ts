import { sortTimeline, timelineOrderKey, type TimelineItem } from './agent-protocol';

/** Merge full part revisions; text-only updates keep the existing order. */
export function upsertTimelineItems(
  previous: readonly TimelineItem[],
  incoming: readonly TimelineItem[]
): TimelineItem[] {
  if (incoming.length === 0) return previous as TimelineItem[];
  const next = [...previous];
  let dirty = false;
  let reordered = false;
  for (const item of incoming) {
    const existing = next.findIndex((row) => row.id === item.id);
    if (existing >= 0) {
      // A catch-up response may have committed a newer revision while this
      // stream update waited for its presentation batch. Never roll it back.
      if (item.seq < next[existing].seq) continue;
      const before = next[existing];
      reordered ||=
        timelineOrderKey(before) !== timelineOrderKey(item) || before.ordinal !== item.ordinal;
      next[existing] = {
        ...item,
        ...(before.order === undefined ? {} : { order: before.order }),
        ...(before.row_key === undefined ? {} : { row_key: before.row_key }),
      };
      dirty = true;
      continue;
    }
    if (item.role === 'user' && item.part.type === 'text') {
      const text = item.part.text.trim();
      const optimistic = next.findIndex(
        (it) =>
          it.id.startsWith('temp_') &&
          it.role === 'user' &&
          it.part.type === 'text' &&
          it.part.text.trim() === text
      );
      if (optimistic >= 0) {
        // The acknowledged row takes the optimistic row's place, exactly: its
        // own id would sort it somewhere else, and the reader would watch
        // their own message move.
        // And its key, for the same reason the order is inherited: the row is
        // the one already on screen, so it keeps the identity it was measured
        // and drawn under. Without this the list discards the height it
        // measured and remounts the row the moment the send is acknowledged.
        const { order, row_key: rowKey } = next[optimistic];
        next[optimistic] = {
          ...item,
          ...(order === undefined ? {} : { order }),
          row_key: rowKey ?? next[optimistic].id,
        };
        reordered = true;
        dirty = true;
        continue;
      }
    }
    next.push(item);
    reordered = true;
    dirty = true;
  }
  if (!dirty) return previous as TimelineItem[];
  return reordered ? sortTimeline(next) : next;
}
