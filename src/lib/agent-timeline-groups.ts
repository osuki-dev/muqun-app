import type { ShellInfo, TimelineItem, TimelineRole } from './agent-session';
import { classifyTool, extractTarget, shellIdFromMetadata } from './agent-tool-output';

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
      // `row_key` where the row has one: an optimistic user message keeps the
      // key it was drawn under when the acknowledgement replaces it, so the
      // list keeps the height it measured instead of remounting the row the
      // reader is looking at. See `TimelineItem.row_key`.
      key: `grp_${item.row_key ?? item.id}`,
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

const SHELL_MATCH_SLOP_MS = 2_000;
const SHELL_ID_MATCH_WINDOW_MS = 30_000;

/** Creation time encoded in an OpenCode ascending id (`kind_<12 hex>…`). */
function openCodeIdTimestamp(id: string): number | undefined {
  const separator = id.indexOf('_');
  const hex = separator >= 0 ? id.slice(separator + 1, separator + 13) : '';
  if (!/^[0-9a-f]{12}$/i.test(hex)) return undefined;
  return Number(BigInt(`0x${hex}`) / BigInt(0x1000));
}

/** Match confidence for a shell event and tool part from one OpenCode execution. */
function shellToolMatchScore(shell: TimelineItem, tool: TimelineItem): number | undefined {
  if (shell.part.type !== 'shell' || tool.part.type !== 'tool') return undefined;
  if (classifyTool(tool.part.name) !== 'shell' || tool.part.background) return undefined;

  const toolShellId = shellIdFromMetadata(tool.part.metadata);
  if (toolShellId) return toolShellId === shell.part.shell_id ? 0 : undefined;
  if (extractTarget('shell', tool.part.input).trim() !== shell.part.command.trim())
    return undefined;

  // OpenCode's ordinary shell tool does not currently put its shell id in
  // metadata. It does return complete per-tool timing, while shell.created and
  // shell.exited carry that execution's start/completion time as updated_ms.
  // That overlap is identity; equal command text from another turn is not.
  const times = [tool.part.time?.created, tool.part.time?.ran, tool.part.time?.completed].filter(
    (value): value is number => typeof value === 'number' && value > 0
  );
  if (shell.updated_ms > 0 && times.length > 0) {
    const start = Math.min(...times) - SHELL_MATCH_SLOP_MS;
    const end = Math.max(...times) + SHELL_MATCH_SLOP_MS;
    if (shell.updated_ms >= start && shell.updated_ms <= end) {
      return Math.min(...times.map((time) => Math.abs(shell.updated_ms - time)));
    }
  }

  // The gateway's shell row may have updated_ms=0 because shell.created uses a
  // different time field. The ids still carry OpenCode's ascending creation
  // clock. Pair each shell with the nearest preceding same-command message;
  // the bounded gap prevents a historical equal command from claiming it.
  const shellCreated = openCodeIdTimestamp(shell.part.shell_id);
  const messageCreated = openCodeIdTimestamp(tool.message_id);
  if (shellCreated === undefined || messageCreated === undefined) return undefined;
  const gap = shellCreated - messageCreated;
  return gap >= 0 && gap <= SHELL_ID_MATCH_WINDOW_MS ? SHELL_MATCH_SLOP_MS + gap : undefined;
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
 * A `shell` part whose identity matches a tool call is that tool call, seen
 * from the other side, and it is dropped. OpenCode's current foreground-shell
 * tool has no shell id, so its complete per-tool timing -- or the ascending
 * creation clocks encoded in the shell and message ids when the event omitted
 * its time -- is correlated instead. Matches are one-to-one. Old records use a
 * deliberately narrow adjacent-command fallback. A command match from
 * elsewhere in the session is not identity: the same command may be run again.
 * What survives is a shell with no call behind it -- one detached by
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
  const shellTools: TimelineItem[] = [];
  let shellParts = 0;
  for (const item of items) {
    const part = item.part;
    if (part.type === 'shell') {
      shellParts += 1;
      continue;
    }
    if (part.type !== 'tool' || classifyTool(part.name) !== 'shell') continue;
    shellTools.push(item);
  }
  if (shellParts === 0) return items;

  const matchedShells = new Set<string>();
  const consumedTools = new Set<number>();
  for (const shell of items) {
    if (shell.part.type !== 'shell') continue;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < shellTools.length; index++) {
      if (consumedTools.has(index)) continue;
      const score = shellToolMatchScore(shell, shellTools[index]);
      if (score === undefined || score >= bestScore) continue;
      bestIndex = index;
      bestScore = score;
    }
    if (bestIndex >= 0) {
      consumedTools.add(bestIndex);
      matchedShells.add(shell.id);
    }
  }

  const byId = new Map(shells.map((shell) => [shell.id, shell]));
  const next: TimelineItem[] = [];
  let changed = false;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const part = item.part;
    if (part.type !== 'shell') {
      next.push(item);
      continue;
    }
    if (matchedShells.has(item.id)) {
      changed = true;
      continue;
    }
    const listed = byId.get(part.shell_id);
    const previousPart = items[index - 1]?.part;
    const isLegacyAdjacentEcho =
      !listed &&
      previousPart?.type === 'tool' &&
      classifyTool(previousPart.name) === 'shell' &&
      !shellIdFromMetadata(previousPart.metadata) &&
      !previousPart.time?.created &&
      !previousPart.time?.ran &&
      !previousPart.time?.completed &&
      openCodeIdTimestamp(items[index - 1]?.message_id ?? '') === undefined &&
      openCodeIdTimestamp(part.shell_id) === undefined &&
      extractTarget('shell', previousPart.input).trim() === part.command.trim();
    if (isLegacyAdjacentEcho) {
      changed = true;
      continue;
    }
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
