import { create } from 'zustand';

import {
  EMPTY_GONE_SESSIONS,
  hiddenSessionKeys,
  markSessionGone,
  resolveSuspectedSessions,
  suspectSession,
  type AgentSessionListing,
  type GoneSessionsState,
  type SuspectedSession,
} from '@/lib/gone-agent-sessions';

/**
 * The agent sessions the gateway has answered "gone" for on this run.
 *
 * Continue merges the gateway's own listing with the device's recents, and a
 * session whose folder was deleted can still be listed there, so forgetting
 * the recent alone would bring the row back on the next refresh and open the
 * same dead session again. A bare `404 session_not_found` is weaker evidence:
 * the gateway answers it during a restart for a session whose agent has not
 * attached yet, so such a session is only suspected -- hidden until the next
 * listing either carries it (it is back) or omits it with authority (it is
 * gone, and its recent goes with it). Memory only: a cold start asks the
 * gateway again. See `lib/gone-agent-sessions` for the decision.
 */
interface GoneAgentSessionsState extends GoneSessionsState {
  /** `gone` and `suspected` together: what Home's rows are filtered through. */
  hidden: ReadonlySet<string>;
  markGone: (serverId: string, asid: string, agentId?: string) => void;
  suspect: (session: Omit<SuspectedSession, 'suspectedAtMs'>) => void;
  /** Settles the listing's gateway's suspected sessions; returns the ones found gone. */
  resolve: (listing: AgentSessionListing) => SuspectedSession[];
}

export const useGoneAgentSessions = create<GoneAgentSessionsState>((set, get) => {
  const write = (next: GoneSessionsState) => {
    if (next.gone !== get().gone || next.suspected !== get().suspected)
      set({ ...next, hidden: hiddenSessionKeys(next) });
  };
  return {
    ...EMPTY_GONE_SESSIONS,
    hidden: new Set(),
    markGone(serverId, asid, agentId) {
      write(markSessionGone(get(), serverId, asid, agentId));
    },
    suspect(session) {
      write(suspectSession(get(), { ...session, suspectedAtMs: Date.now() }));
    },
    resolve(listing) {
      const { state, gone } = resolveSuspectedSessions(get(), listing);
      write(state);
      return gone;
    },
  };
});
