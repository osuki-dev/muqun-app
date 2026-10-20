import {
  inboxItemAttachments,
  inboxItemText,
  sortTimeline,
  timelineOrderKey,
  type InboxItem,
  type TimelineItem,
} from './agent-protocol';

/**
 * Whether a send draws its own optimistic row.
 *
 * Not with attachments: the engine's acknowledged row need not carry the upload
 * paths (images may come back as data URIs, Codex as its own local paths), the
 * send ACK has no message id, and an optimistic row that is never matched
 * survives every snapshot as a duplicate. Not for a queued send either: the
 * inbox item is the queued row (`inboxTimelineRows`), matched by its id.
 */
export function agentPromptUsesOptimisticRow(
  attachments?: readonly string[],
  delivery?: 'steer' | 'queue'
): boolean {
  return !attachments?.length && delivery !== 'queue';
}

const inboxRows = new WeakMap<InboxItem, TimelineItem>();

/**
 * The transcript rows for prompts waiting in the inbox, after the history.
 *
 * Each row stands for one inbox item and carries its id, so cancel and edit
 * act on the item rather than on whatever prompt happens to share its text.
 * A row is built once per item object: an unchanged queue redraws nothing.
 * An optimistic steer row with the same text is the same prompt, already on
 * screen; it is drawn once. When the item is delivered it leaves the inbox and
 * the engine's own user message takes its place.
 */
export function inboxTimelineRows(
  inbox: readonly InboxItem[],
  timeline: readonly TimelineItem[]
): TimelineItem[] {
  const pending = timeline.filter(
    (row) => row.id.startsWith('temp_') && row.role === 'user' && row.part.type === 'text'
  );
  const claimed = new Set<TimelineItem>();
  const out: TimelineItem[] = [];
  for (const item of inbox) {
    if (item.type !== 'user') continue;
    let row = inboxRows.get(item);
    if (!row) {
      const files = inboxItemAttachments(item);
      const key = `inbox_${item.id}`;
      row = {
        id: key,
        row_key: key,
        message_id: key,
        ordinal: 0,
        seq: 0,
        updated_ms: item.timeCreated ?? 0,
        role: 'user',
        part: { type: 'text', text: inboxItemText(item) },
        ...(files.length
          ? {
              attachments: files.map((file) => file.uri),
              attachment_files: files.map(({ name, image }) => ({ name, image })),
            }
          : {}),
        ...(item.image_assets ? { image_assets: item.image_assets } : {}),
        queued: true,
        inbox: { id: item.id, delivery: item.delivery },
      };
      inboxRows.set(item, row);
    }
    const text = row.part.type === 'text' ? row.part.text.trim() : '';
    const twin = row.attachments
      ? undefined
      : pending.find(
          (temp) =>
            !claimed.has(temp) &&
            !temp.attachments?.length &&
            temp.part.type === 'text' &&
            temp.part.text.trim() === text
        );
    if (twin) {
      claimed.add(twin);
      continue;
    }
    out.push(row);
  }
  return out;
}

/** Match the Gateway's exact ByPath transport suffix, never a loose text prefix. */
function acknowledgeAttachments(
  item: TimelineItem,
  before: TimelineItem
): TimelineItem | undefined {
  if (item.part.type !== 'text' || before.part.type !== 'text') return;
  const attachments = before.attachments;
  if (
    item.attachments?.length &&
    attachments?.length &&
    (item.attachments.length !== attachments.length ||
      item.attachments.some((path, index) => path !== attachments[index]))
  )
    return;
  const expected = attachments?.length
    ? `${before.part.text}\n\nAttached files (on this host):${attachments.map((path) => `\n- ${path}`).join('')}`
    : before.part.text;
  if (
    item.part.text.trim() !== before.part.text.trim() &&
    item.part.text.trim() !== expected.trim()
  )
    return;
  return {
    ...item,
    part: { ...item.part, text: before.part.text },
    attachments: item.attachments?.length ? item.attachments : attachments,
  };
}

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
        ...(before.role === 'user' ? (acknowledgeAttachments(item, before) ?? item) : item),
        ...(before.order === undefined ? {} : { order: before.order }),
        ...(before.row_key === undefined ? {} : { row_key: before.row_key }),
      };
      dirty = true;
      continue;
    }
    if (item.role === 'user' && item.part.type === 'text') {
      const optimistic = next.findIndex(
        (it) =>
          it.id.startsWith('temp_') &&
          it.role === 'user' &&
          it.part.type === 'text' &&
          item.seq >= it.seq &&
          acknowledgeAttachments(item, it) !== undefined
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
          ...acknowledgeAttachments(item, next[optimistic])!,
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

/** Replace canonical history without losing a send that raced a stale snapshot. */
export function reconcileAgentSnapshotPending(
  previous: readonly TimelineItem[],
  snapshot: readonly TimelineItem[],
  invalidated = false
): TimelineItem[] {
  const pending = invalidated
    ? []
    : previous.filter((item) => item.id.startsWith('temp_') && item.role === 'user');
  // Do not carry canonical history into a replacement: rollback/deletion can
  // deliberately remove it. The normal upsert preserves an acknowledged row's key.
  // ACK can precede the user-message event, and unrelated events advance the
  // snapshot sequence. Neither absence nor idle status proves send failure.
  return upsertTimelineItems(pending, snapshot);
}
