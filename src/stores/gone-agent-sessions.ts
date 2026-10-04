import { create } from 'zustand';

import { goneSessionKey } from '@/lib/home-continue';

/**
 * The agent sessions the gateway has answered "gone" for on this run.
 *
 * Continue merges the gateway's own listing with the device's recents, and a
 * session whose folder was deleted can still be listed there, so forgetting
 * the recent alone would bring the row back on the next refresh and open the
 * same dead session again. Memory only: a cold start asks the gateway again,
 * which answers the same and puts the session back here.
 */
interface GoneAgentSessionsState {
  keys: ReadonlySet<string>;
  markGone: (serverId: string, asid: string) => void;
}

export const useGoneAgentSessions = create<GoneAgentSessionsState>((set) => ({
  keys: new Set(),
  markGone(serverId, asid) {
    set((state) => {
      const key = goneSessionKey(serverId, asid);
      return state.keys.has(key) ? state : { keys: new Set(state.keys).add(key) };
    });
  },
}));
