import type { AgentSessionInfo } from './agent-protocol';

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

/** Preorder for the virtualized sheet. No recursion, depth limit, or row cap. */
export function flattenSessionTree(
  root: AgentSessionInfo | undefined,
  childrenByParent: ChildrenByParent
): SessionNode[] {
  const nodes: SessionNode[] = [];
  const seen = new Set<string>();
  const pending = root ? [{ session: root, depth: 0 }] : [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || node.session.deleted || seen.has(node.session.asid)) continue;
    seen.add(node.session.asid);
    const children = childrenByParent[node.session.asid] ?? [];
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
  authoritative = false
): ChildrenByParent {
  if (!authoritative && incoming.length === 0) return previous;
  const children = new Map<string, AgentSessionInfo>();
  if (!authoritative) {
    for (const child of previous[parent] ?? []) children.set(child.asid, child);
  }
  const removed = new Set<string>();
  for (const child of incoming) {
    if (child.asid === parent) continue;
    if (child.deleted) {
      children.delete(child.asid);
      removed.add(child.asid);
    } else {
      children.set(child.asid, child);
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

/** Walk every discovered branch, with at most four requests in flight. */
export async function loadSessionDescendants(input: {
  rootAsid: string;
  known: ChildrenByParent;
  listChildren: (asid: string) => Promise<SessionChildrenInventory>;
  isCurrent: () => boolean;
  onChildren: (parent: string, inventory: SessionChildrenInventory) => void;
}): Promise<void> {
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
          : [...(input.known[parent] ?? []), ...inventory.children];
        for (const child of discovered) {
          if (child.deleted || scheduled.has(child.asid)) continue;
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
