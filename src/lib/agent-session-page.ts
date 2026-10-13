import {
  asRecord,
  parseAgentSessionList,
  type AgentFeatures,
  type AgentSessionInfo,
} from './agent-protocol';

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
