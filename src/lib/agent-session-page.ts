import {
  asRecord,
  normalizeAgentId,
  parseAgentSessionList,
  type AgentFeatures,
  type AgentSessionInfo,
} from './agent-protocol';
import { isChildSession, type ChildrenByParent } from './agent-session-tree';

/** Keep the provider's root scope/order, adding only known, reachable descendants. */
export function mergeSessionPageTree(
  roots: readonly AgentSessionInfo[],
  liveSessions: readonly AgentSessionInfo[],
  childrenByParent: ChildrenByParent
): AgentSessionInfo[] {
  const live = new Map(liveSessions.map((session) => [session.asid, session]));
  const index = new Map<string, AgentSessionInfo>();
  for (const [parent, children] of Object.entries(childrenByParent)) {
    for (const child of children) {
      if (isChildSession(child, parent)) index.set(child.asid, child);
    }
  }
  // Live rows override cached children, including tombstones and changed links.
  for (const session of liveSessions) index.set(session.asid, session);
  const children = new Map<string, AgentSessionInfo[]>();
  for (const session of index.values()) {
    if (!session.parent_id || session.deleted) continue;
    const siblings = children.get(session.parent_id) ?? [];
    siblings.push(session);
    children.set(session.parent_id, siblings);
  }
  const result: AgentSessionInfo[] = [];
  const seen = new Set<string>();
  // Reserve root identities so malformed child inventories cannot reparent them.
  const rootIds = new Set(roots.map((root) => root.asid));
  for (const root of roots) {
    const current = live.get(root.asid);
    if (root.parent_id || root.deleted || current?.deleted || seen.has(root.asid)) continue;
    const pending: AgentSessionInfo[] = [{ ...(current ?? root), parent_id: root.parent_id }];
    while (pending.length > 0) {
      const session = pending.pop();
      if (!session || seen.has(session.asid)) continue;
      seen.add(session.asid);
      result.push(session);
      const descendants = children.get(session.asid) ?? [];
      for (let i = descendants.length - 1; i >= 0; i--) {
        const child = descendants[i];
        if (
          child &&
          !rootIds.has(child.asid) &&
          isChildSession(child, session.asid) &&
          normalizeAgentId(child.agent_id) === normalizeAgentId(root.agent_id)
        )
          pending.push(child);
      }
    }
  }
  return result;
}

export function supportsAgentSessionPages(
  capabilities: readonly string[] | undefined,
  features: AgentFeatures | undefined,
  agentId: string | undefined
): boolean {
  return Boolean(
    agentId?.trim() &&
    capabilities?.includes('agent_session_pages_v1') &&
    features?.extra.sessionPagination === true
  );
}

export interface AgentSessionPage {
  sessions: AgentSessionInfo[];
  nextCursor: string | null;
  previousCursor: string | null;
  paginated: boolean;
  authoritative: boolean;
  observedAtMs?: number;
}

/** The versioned content envelope wraps a second data field intentionally. */
export function parseAgentSessionPage(
  value: unknown
): Pick<AgentSessionPage, 'sessions' | 'nextCursor' | 'previousCursor'> {
  const page = asRecord(value);
  const cursor = asRecord(page?.cursor);
  const validCursor = (value: unknown) =>
    value === null || (typeof value === 'string' && value.length > 0);
  if (
    !Array.isArray(page?.data) ||
    !cursor ||
    !validCursor(cursor.next) ||
    !validCursor(cursor.previous)
  )
    throw new Error('Invalid agent session page');
  return {
    sessions: parseAgentSessionList(page.data),
    nextCursor: cursor.next as string | null,
    previousCursor: cursor.previous as string | null,
  };
}

export interface SessionPagesState {
  sessions: readonly AgentSessionInfo[];
  nextCursor: string | null;
  loading: boolean;
  failed: boolean;
}

/** One query owns its requests and cursors. Disposing it prevents every late publication. */
export function createSessionPageLoader(
  read: (cursor: string | undefined, signal: AbortSignal) => Promise<AgentSessionPage>,
  publish: (state: SessionPagesState) => void
) {
  let state: SessionPagesState = { sessions: [], nextCursor: null, loading: false, failed: false };
  let alive = true;
  let started = false;
  let request: AbortController | undefined;
  const seen = new Set<string>();
  const load = async () => {
    if (!alive || state.loading || (started && !state.nextCursor && !state.failed)) return;
    const cursor = started ? (state.nextCursor ?? undefined) : undefined;
    const controller = new AbortController();
    request = controller;
    state = { ...state, loading: true, failed: false };
    publish(state);
    try {
      const page = await read(cursor, controller.signal);
      if (!alive || controller.signal.aborted) return;
      if (!page.authoritative) throw new Error('Session list unavailable');
      if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor)))
        throw new Error('Repeated session page cursor');
      if (cursor) seen.add(cursor);
      const sessions = cursor ? [...state.sessions] : [];
      const ids = new Set(sessions.map((session) => session.asid));
      for (const session of page.sessions) {
        if (!ids.has(session.asid)) sessions.push(session);
        ids.add(session.asid);
      }
      started = true;
      state = { sessions, nextCursor: page.nextCursor, loading: false, failed: false };
      publish(state);
    } catch {
      if (!alive || controller.signal.aborted) return;
      state = { ...state, loading: false, failed: true };
      publish(state);
    }
  };
  return {
    load,
    updateSessions: (
      update: (sessions: readonly AgentSessionInfo[]) => readonly AgentSessionInfo[]
    ) => {
      if (!alive) return;
      state = { ...state, sessions: update(state.sessions) };
      publish(state);
    },
    dispose: () => {
      alive = false;
      request?.abort();
    },
  };
}
