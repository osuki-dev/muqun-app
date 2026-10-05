import { isBusyStatus, type AgentDomainEvent, type AgentSessionInfo } from './agent-protocol';
import { activeFirstSessionChildren } from './agent-session-tree';

/**
 * The open session's subtasks: every session below it by `parent_id`, at any
 * depth, and one line that says whether any of them is still working.
 *
 * Pure, so the workbench row and the tree chip's badge read the same answer.
 */

/** One descendant and how far below the open session it sits (1 = a child). */
export interface SubtaskNode {
  session: AgentSessionInfo;
  depth: number;
}

/** Which of the three things the collapsed row says. */
export type SubtaskSummaryKind = 'blocked' | 'running' | 'idle';

export interface SubtaskSummary {
  total: number;
  running: number;
  blocked: number;
  kind: SubtaskSummaryKind;
}

/** Open requests (permissions and forms) per session, by request id. */
export type SubtaskBlocks = Readonly<Record<string, readonly string[]>>;

/**
 * Every live descendant of `asid`, depth-first, a parent before its children.
 *
 * Siblings keep the listing's order with running ones first. Only `parent_id`
 * links are followed, and each session is visited once, so a cycle or a
 * parent nobody listed cannot loop or leak an unrelated session in.
 */
export function descendantsOf(
  sessions: Iterable<AgentSessionInfo>,
  asid: string | undefined
): SubtaskNode[] {
  if (!asid) return [];
  const children = new Map<string, AgentSessionInfo[]>();
  for (const session of sessions) {
    const parent = session.parent_id;
    if (!parent || session.deleted || parent === session.asid) continue;
    const list = children.get(parent);
    if (list) {
      if (!list.some((known) => known.asid === session.asid)) list.push(session);
    } else {
      children.set(parent, [session]);
    }
  }
  const nodes: SubtaskNode[] = [];
  const seen = new Set<string>([asid]);
  const pending: SubtaskNode[] = [];
  const pushChildren = (parent: string, depth: number) => {
    const ordered = activeFirstSessionChildren(children.get(parent) ?? []);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const child = ordered[i];
      if (child) pending.push({ session: child, depth });
    }
  };
  pushChildren(asid, 1);
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || seen.has(node.session.asid)) continue;
    seen.add(node.session.asid);
    nodes.push(node);
    pushChildren(node.session.asid, node.depth + 1);
  }
  return nodes;
}

/** Whether a session has a permission or a form waiting on the reader. */
export function isSubtaskBlocked(blocks: SubtaskBlocks, asid: string): boolean {
  return (blocks[asid]?.length ?? 0) > 0;
}

/** The collapsed row's numbers, or `null` when the session has no subtasks. */
export function subtaskSummary(
  descendants: readonly SubtaskNode[],
  blocks: SubtaskBlocks = {}
): SubtaskSummary | null {
  if (descendants.length === 0) return null;
  let running = 0;
  let blocked = 0;
  for (const { session } of descendants) {
    if (isSubtaskBlocked(blocks, session.asid)) blocked++;
    else if (isBusyStatus(session.status)) running++;
  }
  const kind: SubtaskSummaryKind = blocked > 0 ? 'blocked' : running > 0 ? 'running' : 'idle';
  return { total: descendants.length, running, blocked, kind };
}

/**
 * Track what a subtask is waiting on from its own events.
 *
 * A request is open from `pending` until `resolved`; a session that stops
 * running has nothing left to wait on. Unchanged input returns `previous`.
 */
export function applySubtaskBlockEvent(
  previous: SubtaskBlocks,
  event: AgentDomainEvent
): SubtaskBlocks {
  const asid = event.asid;
  if (!asid) return previous;
  const open = previous[asid] ?? [];
  const without = (id: string): SubtaskBlocks => {
    if (!open.includes(id)) return previous;
    const rest = open.filter((known) => known !== id);
    const next = { ...previous };
    if (rest.length > 0) next[asid] = rest;
    else delete next[asid];
    return next;
  };
  const withId = (id: string): SubtaskBlocks =>
    open.includes(id) ? previous : { ...previous, [asid]: [...open, id] };
  switch (event.type) {
    case 'agent.permission.pending':
      return withId(event.request.id);
    case 'agent.form.pending':
      return withId(event.request.id);
    case 'agent.permission.resolved':
      return without(event.request_id);
    case 'agent.form.resolved':
      return without(event.form_id);
    case 'agent.status.changed': {
      if (isBusyStatus(event.status) || open.length === 0) return previous;
      const next = { ...previous };
      delete next[asid];
      return next;
    }
    default:
      return previous;
  }
}
