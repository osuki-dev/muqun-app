import type { AgentSessionInfo } from './agent-protocol';

/**
 * The session strip, as a tree rather than a flat row of chips.
 *
 * A subagent run creates a real session whose `parent_id` is the caller's, and
 * those sessions can nest: an `explore` subagent can start one of its own. The
 * strip used to show root sessions, plus -- only under whichever root happened
 * to be active -- its immediate children as sibling chips with no indent, no
 * connector and no way to tell a child from a root. A subagent of a session
 * that was not active did not appear at all.
 *
 * Pure, so the three decisions that matter can be tested without a renderer:
 * which sessions belong to this workspace, which of them the strip draws, and
 * how a child is reached from its parent and back again.
 */

/** One chip in the strip, and how far in it sits. */
export interface SessionNode {
  session: AgentSessionInfo;
  /** 0 for a root, 1 for its children, 2 for theirs. */
  depth: number;
  /** Whether anything is drawn under this one, for the connector's shape. */
  hasChildren: boolean;
}

/**
 * How deep the strip goes.
 *
 * Two levels under a root is what OpenCode's own permissions allow -- `explore`
 * denies the `subagent` tool, so it cannot recurse -- and a horizontal strip
 * has no room to say "four levels in" anyway. Anything deeper is still
 * reachable by opening the child and reading its own strip.
 */
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

/**
 * The chips the strip draws.
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
