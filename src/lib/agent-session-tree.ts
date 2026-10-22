import { isBusyStatus, normalizeAgentId, type AgentSessionInfo } from './agent-protocol';
import { sameData } from './same-data';

/** Separate projections for the root strip, nested sheet and legacy header swipe window. */

/** One session in a projection, and its actual (not visually clamped) depth. */
export interface SessionNode {
  session: AgentSessionInfo;
  /** 0 for a root, 1 for its children, and so on. */
  depth: number;
  /** Whether anything is drawn under this one, for the connector's shape. */
  hasChildren: boolean;
}

/** Legacy header swipe window. The tree sheet does not use these bounds. */
export const SESSION_TREE_MAX_DEPTH = 2;

/** A hard cap on chips, so a runaway fan-out cannot render unbounded. */
export const SESSION_STRIP_MAX_NODES = 60;

export type ChildrenByParent = Readonly<Record<string, readonly AgentSessionInfo[]>>;

/** A bounded or delayed listing must not hide the root currently being read. */
export function includeOpenedRoot(
  roots: readonly AgentSessionInfo[],
  opened: AgentSessionInfo | null,
  activeAsid: string | undefined
): readonly AgentSessionInfo[] {
  if (
    !opened ||
    opened.asid !== activeAsid ||
    opened.parent_id ||
    opened.deleted ||
    roots.some((root) => root.asid === opened.asid)
  ) {
    return roots;
  }
  return [opened, ...roots];
}

/**
 * Keep live subagents visible before historical siblings without changing the
 * Gateway's order within either group. `idle` is not a completion signal.
 */
export function activeFirstSessionChildren(
  children: readonly AgentSessionInfo[]
): AgentSessionInfo[] {
  return [
    ...children.filter((child) => isBusyStatus(child.status)),
    ...children.filter((child) => !isBusyStatus(child.status)),
  ];
}

/**
 * Whether `child` is really a child of `parent`, by its own `parent_id` link.
 *
 * A `/children` inventory is not proof: an adapter that ignores the parent
 * filter answers with every session it has, all of them roots. Trusting that
 * listing nested every unrelated root under the previous one in the sheet.
 */
export function isChildSession(child: AgentSessionInfo, parent: string): boolean {
  return child.parent_id === parent && child.asid !== parent;
}

/** Every session in hand, by id: roots and whatever children were fetched. */
export function indexSessions(
  roots: readonly AgentSessionInfo[],
  childrenByParent: ChildrenByParent
): Map<string, AgentSessionInfo> {
  const index = new Map<string, AgentSessionInfo>();
  for (const root of roots) index.set(root.asid, root);
  for (const children of Object.values(childrenByParent)) {
    for (const child of children) index.set(child.asid, child);
  }
  return index;
}

/**
 * The chain from a session up to its root, nearest first.
 *
 * Bounded by the index's own size, because a `parent_id` cycle is a thing a
 * remote program can send and an unbounded `while` is a thing a phone cannot
 * survive.
 */
export function ancestorPath(
  asid: string | undefined,
  index: ReadonlyMap<string, AgentSessionInfo>
): AgentSessionInfo[] {
  const path: AgentSessionInfo[] = [];
  if (!asid) return path;
  const seen = new Set<string>();
  let current = index.get(asid);
  while (current && !seen.has(current.asid)) {
    seen.add(current.asid);
    path.push(current);
    current = current.parent_id ? index.get(current.parent_id) : undefined;
  }
  return path;
}

/** The root a session belongs to, or the session itself. */
export function rootOf(
  asid: string | undefined,
  index: ReadonlyMap<string, AgentSessionInfo>
): AgentSessionInfo | undefined {
  const path = ancestorPath(asid, index);
  return path.length > 0 ? path[path.length - 1] : undefined;
}

/** The session directly above this one, when it is known. */
export function parentOf(
  asid: string | undefined,
  index: ReadonlyMap<string, AgentSessionInfo>
): AgentSessionInfo | undefined {
  const path = ancestorPath(asid, index);
  return path.length > 1 ? path[1] : undefined;
}

/** Only actual roots belong in the horizontal strip, even in a mixed listing. */
export function buildRootSessionStrip(
  sessions: readonly AgentSessionInfo[],
  childrenByParent: ChildrenByParent,
  activeAsid: string | undefined
): { nodes: SessionNode[]; selectedRootAsid: string | undefined } {
  const index = indexSessions(sessions, childrenByParent);
  const knownParents = new Set<string>();
  for (const session of index.values()) {
    if (!session.deleted && session.parent_id && session.parent_id !== session.asid) {
      knownParents.add(session.parent_id);
    }
  }
  const seen = new Set<string>();
  const nodes: SessionNode[] = [];
  for (const candidate of sessions) {
    const session = index.get(candidate.asid) ?? candidate;
    if (session.parent_id || session.deleted || seen.has(session.asid)) continue;
    seen.add(session.asid);
    nodes.push({
      session,
      depth: 0,
      hasChildren:
        knownParents.has(session.asid) ||
        (childrenByParent[session.asid] ?? []).some(
          (child) => !child.deleted && child.asid !== session.asid
        ),
    });
  }
  const root = rootOf(activeAsid, index);
  return { nodes, selectedRootAsid: root && seen.has(root.asid) ? root.asid : undefined };
}

/**
 * Preorder of one root's subtree for the virtualized sheet. No recursion,
 * depth limit, or row cap. Only `parent_id` links are followed, so a row filed
 * under the wrong parent (or another agent's session, when `agentId` is
 * given) never appears, and unrelated roots can never chain into depth.
 */
export function flattenSessionTree(
  root: AgentSessionInfo | undefined,
  childrenByParent: ChildrenByParent,
  agentId?: string
): SessionNode[] {
  const nodes: SessionNode[] = [];
  const seen = new Set<string>();
  const pending = root ? [{ session: root, depth: 0 }] : [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || node.session.deleted || seen.has(node.session.asid)) continue;
    seen.add(node.session.asid);
    const children = activeFirstSessionChildren(
      sessionsOfAgent(childrenByParent[node.session.asid] ?? [], agentId).filter((child) =>
        isChildSession(child, node.session.asid)
      )
    );
    nodes.push({
      ...node,
      hasChildren: children.some((child) => !child.deleted && !seen.has(child.asid)),
    });
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) pending.push({ session: child, depth: node.depth + 1 });
    }
  }
  return nodes;
}

/** Reconcile a successful inventory; fallbacks only update facts they explicitly carry. */
export function mergeSessionChildren(
  previous: ChildrenByParent,
  parent: string,
  incoming: readonly AgentSessionInfo[],
  authoritative = false,
  observedAtRequest?: readonly AgentSessionInfo[]
): ChildrenByParent {
  if (!authoritative && incoming.length === 0) return previous;
  const children = new Map<string, AgentSessionInfo>();
  if (!authoritative) {
    for (const child of previous[parent] ?? []) children.set(child.asid, child);
  }
  const removed = new Set<string>();
  for (const child of incoming) {
    if (!isChildSession(child, parent)) continue;
    if (child.deleted) {
      children.delete(child.asid);
      removed.add(child.asid);
    } else {
      children.set(child.asid, child);
    }
  }
  // A GET describes an earlier snapshot. A child announced or updated on the
  // stream while it was in flight must not disappear behind that response.
  // Unchanged history is still reconciled against the authoritative inventory.
  if (authoritative && observedAtRequest) {
    const observed = new Map(observedAtRequest.map((child) => [child.asid, child]));
    for (const child of previous[parent] ?? []) {
      if (observed.get(child.asid) !== child && !removed.has(child.asid)) {
        children.set(child.asid, child);
      }
    }
  }
  for (const child of previous[parent] ?? []) {
    if (!children.has(child.asid)) removed.add(child.asid);
  }

  const next: Record<string, readonly AgentSessionInfo[]> = {
    ...previous,
    [parent]: [...children.values()],
  };
  const pending = [...removed];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const removedAsid = pending.pop();
    if (!removedAsid || removedAsid === parent || seen.has(removedAsid)) continue;
    seen.add(removedAsid);
    for (const descendant of previous[removedAsid] ?? []) pending.push(descendant.asid);
    delete next[removedAsid];
  }
  return next;
}

export interface SessionChildrenInventory {
  children: readonly AgentSessionInfo[];
  authoritative: boolean;
}

/** A whole subtree in one answer, flat; see `listAgentSessionDescendantsObserved`. */
export interface SessionDescendantsInventory {
  descendants: readonly AgentSessionInfo[];
  authoritative: boolean;
  truncated: boolean;
}

/**
 * A flat subtree sorted into per-parent inventories, the shape the walk
 * reports in: the root and every descendant that is itself listed get an
 * entry, so a parent whose children are all gone is reported empty rather
 * than left alone. A session naming a parent that is not in the subtree is
 * dropped: it is not under this root, whatever it says. A deleted session
 * stays in its parent's list -- the merge removes it -- but has no children
 * entry of its own.
 */
export function groupDescendantsByParent(
  rootAsid: string,
  descendants: readonly AgentSessionInfo[]
): Record<string, AgentSessionInfo[]> {
  const byParent = new Map<string, AgentSessionInfo[]>();
  for (const session of descendants) {
    const parent = session.parent_id;
    if (!parent || !isChildSession(session, parent)) continue;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(session);
    else byParent.set(parent, [session]);
  }
  // Walked from the root rather than taken as listed, so a session that
  // names a parent outside the subtree is left out and a `parent_id` cycle
  // -- which a remote program can send -- ends with the sessions it reaches.
  const grouped: Record<string, AgentSessionInfo[]> = {};
  const queue = [rootAsid];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index];
    const children = byParent.get(parent) ?? [];
    grouped[parent] = children;
    for (const child of children) {
      if (child.deleted || seen.has(child.asid)) continue;
      seen.add(child.asid);
      queue.push(child.asid);
    }
  }
  return grouped;
}

/**
 * Discover a root's whole subtree.
 *
 * With `listDescendants` -- the gateway advertised `session_descendants` --
 * it is one request, sorted into the same per-parent inventories the walk
 * would have reported, each authoritative. A subtree the gateway cut short
 * (`truncated`) is reported non-authoritatively, so nothing it listed can
 * erase a child the stream announced, and then walked from the root as
 * before with what it listed as the known starting point: correctness costs
 * the old number of requests only in that case. A descendants request that
 * fails is also walked, so a gateway that advertised the route and then
 * refused it degrades to the old behaviour rather than to nothing.
 *
 * Without it, the walk: every discovered branch, at most four requests in flight.
 */
export async function loadSessionDescendants(input: {
  rootAsid: string;
  known: ChildrenByParent;
  listChildren: (asid: string) => Promise<SessionChildrenInventory>;
  /** One request for the whole subtree, when the gateway offers it. */
  listDescendants?: (asid: string) => Promise<SessionDescendantsInventory>;
  isCurrent: () => boolean;
  onChildren: (parent: string, inventory: SessionChildrenInventory) => void;
}): Promise<void> {
  let known = input.known;
  if (input.listDescendants) {
    let inventory: SessionDescendantsInventory | null = null;
    try {
      inventory = await input.listDescendants(input.rootAsid);
    } catch {
      inventory = null;
    }
    if (!input.isCurrent()) return;
    if (inventory?.authoritative) {
      const grouped = groupDescendantsByParent(input.rootAsid, inventory.descendants);
      const authoritative = !inventory.truncated;
      for (const [parent, children] of Object.entries(grouped)) {
        input.onChildren(parent, { children, authoritative });
      }
      if (authoritative) return;
      known = { ...known, ...grouped };
    }
  }
  const pending = [input.rootAsid];
  const scheduled = new Set(pending);
  let offset = 0;
  while (offset < pending.length && input.isCurrent()) {
    const batch = pending.slice(offset, offset + 4);
    offset += batch.length;
    await Promise.all(
      batch.map(async (parent) => {
        if (!input.isCurrent()) return;
        let inventory: SessionChildrenInventory = { children: [], authoritative: false };
        try {
          inventory = await input.listChildren(parent);
        } catch {
          // Keep walking previously known branches when this endpoint is unavailable.
        }
        if (!input.isCurrent()) return;
        input.onChildren(parent, inventory);
        const discovered = inventory.authoritative
          ? inventory.children
          : [...(known[parent] ?? []), ...inventory.children];
        for (const child of discovered) {
          if (child.deleted || !isChildSession(child, parent) || scheduled.has(child.asid)) {
            continue;
          }
          scheduled.add(child.asid);
          pending.push(child.asid);
        }
      })
    );
  }
}

/**
 * The bounded navigation window the header swipes through.
 *
 * Every root, in the order they were given, and under the *active* root its
 * subtree -- children, and their children one level further. A root that is
 * not active stays one chip: the strip is a phone-width row, and expanding
 * every tree in it would bury the roots.
 */
export function buildSessionStrip(
  roots: readonly AgentSessionInfo[],
  childrenByParent: ChildrenByParent,
  activeAsid: string | undefined,
  maxNodes = SESSION_STRIP_MAX_NODES
): SessionNode[] {
  const index = indexSessions(roots, childrenByParent);
  const activeRoot = rootOf(activeAsid, index);
  const nodes: SessionNode[] = [];

  const childrenOf = (asid: string): readonly AgentSessionInfo[] => childrenByParent[asid] ?? [];

  const push = (session: AgentSessionInfo, depth: number): boolean => {
    if (nodes.length >= maxNodes) return false;
    nodes.push({ session, depth, hasChildren: childrenOf(session.asid).length > 0 });
    return true;
  };

  const walk = (session: AgentSessionInfo, depth: number) => {
    if (depth >= SESSION_TREE_MAX_DEPTH) return;
    for (const child of childrenOf(session.asid)) {
      if (!push(child, depth + 1)) return;
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    if (!push(root, 0)) break;
    if (activeRoot && root.asid === activeRoot.asid) walk(root, 0);
  }

  return nodes;
}

/**
 * The roots that belong to the workspace on screen.
 *
 * The gateway can scope the listing by `directory`, and the app asks it to;
 * this is the second filter, for a listing that was not scoped -- a session's
 * `project_id` matching, its directory being the workspace, or its directory
 * being inside it.
 */
export function sessionsInWorkspace(
  sessions: readonly AgentSessionInfo[],
  workspace: { directory?: string; projectId?: string; canonical?: string }
): AgentSessionInfo[] {
  const directory = workspace.directory?.replace(/\/+$/, '');
  const canonical = workspace.canonical?.replace(/\/+$/, '');
  const projectId = workspace.projectId;
  if (!directory && !canonical && !projectId) return [];

  return sessions.filter((session) => {
    if (projectId && session.project_id === projectId) return true;
    if (!session.directory) return false;
    const dir = session.directory.replace(/\/+$/, '');
    if (directory && (dir === directory || dir.startsWith(`${directory}/`))) return true;
    if (canonical && (dir === canonical || dir.startsWith(`${canonical}/`))) return true;
    return false;
  });
}

/**
 * The agent whose sessions the workbench lists, or none on a gateway without
 * agent discovery (it drives one agent, and its rows carry no `agent_id`).
 *
 * The open session's own agent wins. Before there is one -- a launch tile's
 * new session -- the agent the screen was opened for, and only then the
 * reader's pick: the pick is written from `initialAgentId` an effect later,
 * and until then it still names whichever agent was last chosen.
 */
export function workbenchAgentId(input: {
  discovered: boolean;
  sessionAgentId?: string | null;
  initialAgentId?: string;
  selectedAgentId?: string;
}): string | undefined {
  if (!input.discovered) return undefined;
  const id = input.sessionAgentId || input.initialAgentId || input.selectedAgentId;
  return id ? normalizeAgentId(id) : undefined;
}

/**
 * The sessions that belong to `agentId`, or all of them when no agent is named.
 *
 * Every session belongs to exactly one agent; a row without `agent_id` is the
 * default agent's, which is what the gateway answers for when none is said.
 */
export function sessionsOfAgent<T extends Pick<AgentSessionInfo, 'agent_id'>>(
  sessions: readonly T[],
  agentId: string | undefined
): readonly T[] {
  if (!agentId) return sessions;
  const id = normalizeAgentId(agentId);
  return sessions.filter((session) => normalizeAgentId(session.agent_id) === id);
}

/**
 * `next`, reusing every `previous` session whose data has not changed -- and
 * `previous` itself when nothing did.
 *
 * Each inventory read and stream event hands over freshly parsed sessions. Kept
 * as they arrive, every strip chip would re-render on every read, and a list
 * that did not change at all would rebuild the strip, the header's swipe order
 * and the sheets' snapshot for nothing.
 */
export function reuseUnchangedSessions(
  previous: readonly AgentSessionInfo[],
  next: readonly AgentSessionInfo[]
): AgentSessionInfo[] {
  const known = new Map(previous.map((session) => [session.asid, session]));
  let same = previous.length === next.length;
  const kept = next.map((session, position) => {
    const held = known.get(session.asid);
    const result = held && held !== session && sameData(held, session) ? held : session;
    if (result !== previous[position]) same = false;
    return result;
  });
  return same ? (previous as AgentSessionInfo[]) : kept;
}
