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
      // The Gateway may queue an optimistic steer during compaction. Its
      // acknowledged receipt must supply the status and cancel/edit identity.
      out.push({ ...row, id: twin.id, row_key: twin.row_key, message_id: twin.message_id });
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

/** The key a row is drawn under: see `TimelineItem.row_key`. */
export function drawnRowKey(item: TimelineItem): string {
  return item.row_key ?? item.id;
}

/** What a row says, for telling the same row apart from a changed one. */
function rowSignature(item: TimelineItem): string | undefined {
  const { part } = item;
  if (part.type !== 'text' && part.type !== 'reasoning') return undefined;
  return JSON.stringify([item.role, part.type, part.text]);
}

/**
 * A replacement snapshot can bring the same conversation back under new ids.
 * An ACP runtime re-ids every replayed turn when it loads a session, and it
 * loads one on the first send after its process is gone -- so the resync
 * that send provokes re-keyed every row at once, the list discarded every
 * height it had measured and remounted every row, and the transcript went
 * blank until it had measured again.
 *
 * Rows the previous timeline already drew keep their drawn key: matched by
 * id, or else in order by what they say. Everything else is keyed by its own
 * id, as before. Optimistic rows are left to `upsertTimelineItems`, which
 * already hands their key to the acknowledged row.
 */
export function carryDrawnRowKeys(
  previous: readonly TimelineItem[],
  snapshot: readonly TimelineItem[]
): TimelineItem[] {
  const byId = new Map(previous.map((item, index) => [item.id, index] as const));
  // Rows the snapshot still carries under their id are matched first, so a
  // row that only says the same thing can never take their key.
  const consumed = new Set<number>();
  const matchedById = snapshot.map((item) => {
    const index = byId.get(item.id);
    if (index === undefined || consumed.has(index)) return undefined;
    consumed.add(index);
    return index;
  });
  const taken = new Set(snapshot.map(drawnRowKey));
  let cursor = 0;
  return snapshot.map((item, at) => {
    let index = matchedById[at];
    if (index === undefined) {
      const signature = rowSignature(item);
      if (signature === undefined) return item;
      for (let candidate = cursor; candidate < previous.length; candidate++) {
        if (
          consumed.has(candidate) ||
          previous[candidate].id.startsWith('temp_') ||
          rowSignature(previous[candidate]) !== signature
        )
          continue;
        index = candidate;
        break;
      }
      if (index === undefined) return item;
      consumed.add(index);
    }
    cursor = Math.max(cursor, index + 1);
    const key = drawnRowKey(previous[index]);
    // An unchanged row keeps the object it was drawn from: a fresh parse of the
    // same revision would re-render every visible row on each snapshot.
    if (
      previous[index].id === item.id &&
      previous[index].seq === item.seq &&
      previous[index].updated_ms === item.updated_ms &&
      drawnRowKey(item) === key
    )
      return previous[index];
    return drawnRowKey(item) === key || taken.has(key) ? item : { ...item, row_key: key };
  });
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
  return upsertTimelineItems(pending, carryDrawnRowKeys(previous, snapshot));
}

/**
 * Whether storing `next` would change nothing on screen: the same rows, in the
 * same order, as the very same objects. A snapshot that repeats the timeline
 * must not replace it, or every visible row re-renders on each send.
 */
export function sameTimeline(
  previous: readonly TimelineItem[],
  next: readonly TimelineItem[]
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((item, index) => item === next[index]);
}
