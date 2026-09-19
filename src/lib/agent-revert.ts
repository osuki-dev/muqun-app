import type { AgentSessionRevert, TimelineItem } from './agent-protocol';

/**
 * What a staged rollback is about to do, counted from what is on screen.
 *
 * The gateway states the boundary -- one `message_id` -- and the files, and
 * that is all it states. "Rolling back to msg_019a2f…" is not a sentence anyone
 * can act on, so the count of messages is worked out here from the transcript
 * the reader is looking at: the boundary message and everything after it, which
 * is exactly what OpenCode deletes when the rollback is committed.
 *
 * Pure, and separate from the workbench, because the arithmetic is the part
 * worth being sure about: an off-by-one here is a sentence that says the app
 * will delete three messages when it is about to delete four.
 */

/** Every message id in the transcript, in the order they first appear. */
function messageOrder(items: readonly TimelineItem[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const item of items) {
    if (item.message_id && !seen.has(item.message_id)) {
      seen.add(item.message_id);
      order.push(item.message_id);
    }
  }
  return order;
}

/**
 * How many messages the rollback would take with it: the boundary and
 * everything after it.
 *
 * Zero when the boundary is not in the window the app holds -- a number made up
 * from a transcript that does not contain the boundary would be a guess, and
 * the plate says "files" alone rather than guessing.
 */
export function revertedMessageCount(
  items: readonly TimelineItem[],
  messageId: string | undefined
): number {
  if (!messageId) return 0;
  const order = messageOrder(items);
  const at = order.indexOf(messageId);
  return at < 0 ? 0 : order.length - at;
}

/** How many files the rollback would put back. */
export function revertedFileCount(revert: AgentSessionRevert | null | undefined): number {
  return revert?.files?.length ?? 0;
}

/**
 * The rows a committed rollback deleted, taken out of the transcript.
 *
 * `agent.timeline.removed` is the only notice that rows have gone: OpenCode
 * deletes the boundary message and everything after it and has no event of its
 * own for that, so the gateway sends the ids. Nothing is scrolled and nothing
 * is re-anchored -- the rows leave from under the reader's eyes, which is what
 * they asked for, and the viewport stays where it is.
 *
 * The same array comes back when nothing matched, so a spurious event costs no
 * render.
 */
export function removeTimelineItems(
  previous: readonly TimelineItem[],
  ids: readonly string[]
): TimelineItem[] {
  if (ids.length === 0) return previous as TimelineItem[];
  const removed = new Set(ids);
  const kept = previous.filter((item) => !removed.has(item.id));
  return kept.length === previous.length ? (previous as TimelineItem[]) : kept;
}
