import type { TimelineItem, TimelineRole } from './agent-session';

/**
 * One rendered message: the timeline's flat per-part items grouped back into
 * the shape OpenCode's own UI renders — a message owns its parts, so the
 * reasoning ("thinking") and the tool calls made inside it fold into a single
 * block instead of scrolling past as separate list rows.
 */
export interface TimelineRenderGroup {
  key: string;
  role: TimelineRole;
  items: TimelineItem[];
  /** The timeline item directly before this group, for tool-output dedup. */
  prevItem?: TimelineItem;
}

/**
 * Cheap identity signature for reuse: each item's id and revision, plus the
 * item before the group.
 *
 * `seq` is the revision -- the gateway bumps it on every upsert of a row, so a
 * streaming text part that grew has a different one. `updated_ms` is carried
 * with it because a gateway that does not number a row leaves `seq` at 0 for
 * every revision of it, and a signature that cannot tell two revisions apart
 * is the one thing this must never be: a false *reuse* hands a memoised cell
 * stale content, while a false miss only costs a re-render.
 */
function groupSignature(group: Pick<TimelineRenderGroup, 'items' | 'prevItem'>): string {
  const parts: string[] = [];
  for (const item of group.items) {
    parts.push(`${item.id}:${item.seq ?? 0}:${item.updated_ms ?? 0}`);
  }
  const prev = group.prevItem;
  parts.push(prev ? `p${prev.id}:${prev.seq ?? 0}:${prev.updated_ms ?? 0}` : 'p-');
  return parts.join('|');
}

/**
 * Group consecutive timeline items that share a `message_id` into one message.
 *
 * `previous` carries the groups the last render emitted. A group whose items
 * and preceding item are unchanged is **reused as the same object reference**,
 * so memoised message cells skip rendering on the SSE ticks of a *different*
 * message -- a streamed reply then costs one cell re-render instead of the
 * whole visible list. That reference identity is exactly what the list's
 * `itemsAreEqual` asserts, so it has to mean what it says.
 *
 * Two bugs lived in the previous shape of this loop, and both came from
 * deciding whether to reuse *while* the group was still being filled.
 *
 * **A reused group was then mutated.** The reuse test ran when the group held
 * its first item; the next item with the same `message_id` was pushed straight
 * into whichever object had been chosen -- including one taken from
 * `previous`. So an assistant message that gained a tool call kept its old
 * object reference, `itemsAreEqual` said nothing had changed, and the memoised
 * cell never drew the new part. The reader watched a tool run and saw nothing.
 *
 * **And the reuse almost never applied anyway.** The signature was computed
 * against a one-item candidate, so a group of more than one item could not
 * match a prior group of more than one item, and the memo it exists to enable
 * was dead for every message with a tool call in it.
 *
 * So the groups are built whole first, and only a *completed* group is
 * compared. Nothing is ever pushed into an object that came from `previous`.
 */
export function buildTimelineGroups(
  items: TimelineItem[],
  previous?: readonly TimelineRenderGroup[]
): TimelineRenderGroup[] {
  const fresh: TimelineRenderGroup[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const last = fresh[fresh.length - 1];
    if (last && last.items[0].message_id === item.message_id) {
      last.items.push(item);
      continue;
    }
    fresh.push({
      key: `grp_${item.id}`,
      role: item.role,
      items: [item],
      prevItem: i > 0 ? items[i - 1] : undefined,
    });
  }

  if (!previous || previous.length === 0) return fresh;

  return fresh.map((group, index) => {
    const prior = previous[index];
    if (!prior || prior.key !== group.key) return group;
    return groupSignature(prior) === groupSignature(group) ? prior : group;
  });
}

/**
 * The previous render's groups, so `buildTimelineGroups` can reuse them.
 *
 * A plain box rather than a React ref: a ref written while rendering is a ref
 * React may throw away, and `react/refs` forbids it. Filling this during render
 * is safe where a ref is not, because the operation is idempotent -- calling
 * `buildTimelineGroupsCached` twice with the same items returns the identical
 * group objects the second time, which is exactly what Strict Mode's double
 * render does.
 */
export interface TimelineGroupCache {
  last: readonly TimelineRenderGroup[];
}

export function createTimelineGroupCache(): TimelineGroupCache {
  return { last: [] };
}

/**
 * Group the timeline, reusing every group the last call produced that has not
 * changed.
 *
 * This is the half of the identity deal the list's `itemsAreEqual` depends on:
 * a group whose object is the same object has not changed, guaranteed here
 * rather than re-derived per cell. Without it every group is a new object on
 * every SSE tick, and a streamed reply re-renders the whole visible list
 * instead of one cell.
 */
export function buildTimelineGroupsCached(
  cache: TimelineGroupCache,
  items: TimelineItem[]
): TimelineRenderGroup[] {
  const next = buildTimelineGroups(items, cache.last);
  cache.last = next;
  return next;
}
