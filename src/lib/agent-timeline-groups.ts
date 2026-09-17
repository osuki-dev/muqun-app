import type { ShellInfo, TimelineItem, TimelineRole } from './agent-session';
import { classifyTool, extractTarget } from './agent-tool-output';

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

/**
 * One card per shell.
 *
 * The gateway maps OpenCode's `Shell` message into a `shell` timeline part, and
 * the tool call that started the shell arrives as a `tool` part of its own. So
 * every `ls -la` the model ran was drawn twice: once in place, correctly, and
 * once more in a group of `shell` parts that -- sorting after every `msg_` id
 * -- piled up at the bottom of the transcript and grew for the life of the
 * session. Each of those copies wore a `Background` chip and a "Background
 * tasks" button whether or not anything had been detached, and one of them was
 * still spinning half an hour after the turn it belonged to was interrupted.
 *
 * A `shell` part that names a command a tool call in the same session already
 * ran is that tool call, seen from the other side, and it is dropped. What
 * survives is a shell with no call behind it -- one detached by
 * `POST …/background`, or one `/api/agent-shells` is reporting that this
 * transcript never started -- and that is drawn once, in place, as the
 * background card it actually is.
 *
 * The shell list is the authority on what is still running: a detached shell
 * the tray no longer lists has finished, whatever the snapshot that carried the
 * part said. That is the same fact the tray's own counter is drawn from, so the
 * card and the tray cannot disagree.
 *
 * Returns the array it was given when nothing changed -- the memoised cells
 * downstream compare by reference.
 */
export function reconcileShellParts(
  items: TimelineItem[],
  shells: readonly ShellInfo[]
): TimelineItem[] {
  const toolCommands = new Set<string>();
  let shellParts = 0;
  for (const item of items) {
    const part = item.part;
    if (part.type === 'shell') {
      shellParts += 1;
      continue;
    }
    if (part.type !== 'tool' || classifyTool(part.name) !== 'shell') continue;
    const command = extractTarget('shell', part.input).trim();
    if (command) toolCommands.add(command);
  }
  if (shellParts === 0) return items;

  const byId = new Map(shells.map((shell) => [shell.id, shell]));
  const next: TimelineItem[] = [];
  let changed = false;
  for (const item of items) {
    const part = item.part;
    if (part.type !== 'shell') {
      next.push(item);
      continue;
    }
    if (toolCommands.has(part.command.trim())) {
      changed = true;
      continue;
    }
    const listed = byId.get(part.shell_id);
    const status = listed ? listed.status : part.status === 'running' ? 'exited' : part.status;
    if (status === part.status) {
      next.push(item);
      continue;
    }
    changed = true;
    next.push({ ...item, part: { ...part, status } });
  }
  return changed ? next : items;
}
