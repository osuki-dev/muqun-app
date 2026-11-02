import { goneSessionKey } from './home-continue';

/** One gateway's one session, as the read that answered 404 for it named it. */
export type SuspectedSession = {
  serverId: string;
  asid: string;
  agentId?: string;
  /** This device's clock at the 404: only a listing read after it can settle the session. */
  suspectedAtMs: number;
};

/**
 * What one successful listing saw of a gateway's sessions -- Continue's
 * `/api/agent-sessions` read or the gateway's pushed Home overview: the
 * evidence that decides whether a session a read answered 404 for is gone.
 */
export type AgentSessionListing = {
  serverId: string;
  /** This device's clock when the listing was read. */
  observedAtMs: number;
  /** Every row read: the merged page, plus the folders listed for remembered sessions. */
  seen: readonly { asid: string; agentId: string; deleted?: boolean }[];
  /** The page held fewer rows than its cap, so it is the whole listing. */
  complete: boolean;
  /** Sessions whose own folder was listed as well, so their absence is not paging. */
  searched: readonly string[];
};

export type GoneSessionsState = {
  /** `goneSessionKey`s the gateway confirmed gone: never un-marked on this run. */
  gone: ReadonlySet<string>;
  /** Sessions one read answered 404 for, hidden until a listing decides. */
  suspected: readonly SuspectedSession[];
};

export const EMPTY_GONE_SESSIONS: GoneSessionsState = { gone: new Set(), suspected: [] };

function suspectedKey({ serverId, asid, agentId }: SuspectedSession): string {
  return goneSessionKey(serverId, asid, agentId);
}

/** Every key Home hides: the confirmed gone and the suspected alike. */
export function hiddenSessionKeys(state: GoneSessionsState): ReadonlySet<string> {
  return new Set([...state.gone, ...state.suspected.map(suspectedKey)]);
}

/** The gateway's confirmed word (a deletion it carried out, a folder it found missing). */
export function markSessionGone(
  state: GoneSessionsState,
  serverId: string,
  asid: string,
  agentId?: string
): GoneSessionsState {
  const key = goneSessionKey(serverId, asid, agentId);
  if (state.gone.has(key)) return state;
  return { gone: new Set(state.gone).add(key), suspected: state.suspected };
}

/**
 * A snapshot read answered `404 session_not_found`. That alone is not a
 * deletion: a gateway answers it for a session whose agent is still attaching
 * after a restart. The session is hidden, and the next listing decides.
 */
export function suspectSession(
  state: GoneSessionsState,
  session: SuspectedSession
): GoneSessionsState {
  const key = suspectedKey(session);
  if (state.gone.has(key) || state.suspected.some((other) => suspectedKey(other) === key))
    return state;
  return { gone: state.gone, suspected: [...state.suspected, session] };
}

/**
 * A listing settles the suspected sessions of its gateway that it was read
 * after. One it carries is back; one it omits is gone only when the listing
 * is authoritative about it: the page was complete or the session's folder
 * was searched, and the agent that owns it answered (it has rows in the
 * listing), since the merged list silently skips an agent that is not
 * attached yet. Anything else stays suspected. The sessions found gone are
 * returned, so the caller can forget their recents.
 */
export function resolveSuspectedSessions(
  state: GoneSessionsState,
  listing: AgentSessionListing
): { state: GoneSessionsState; gone: SuspectedSession[] } {
  const gone: SuspectedSession[] = [];
  const suspected: SuspectedSession[] = [];
  for (const session of state.suspected) {
    if (session.serverId !== listing.serverId || listing.observedAtMs < session.suspectedAtMs) {
      suspected.push(session);
      continue;
    }
    const rows = listing.seen.filter(
      (row) => row.asid === session.asid && (!session.agentId || row.agentId === session.agentId)
    );
    if (rows.some((row) => !row.deleted)) continue;
    const authoritative =
      rows.length > 0 ||
      ((listing.complete || listing.searched.includes(session.asid)) &&
        (!session.agentId || listing.seen.some((row) => row.agentId === session.agentId)));
    if (authoritative) gone.push(session);
    else suspected.push(session);
  }
  if (gone.length === 0 && suspected.length === state.suspected.length) return { state, gone };
  const keys = new Set(state.gone);
  for (const session of gone) keys.add(suspectedKey(session));
  return { state: { gone: keys, suspected }, gone };
}
