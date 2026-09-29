import { create } from 'zustand';

import type { GatewayAgentSessionsSnapshot } from '@/lib/home-continue';

/**
 * The agent sessions each gateway last listed for Continue.
 *
 * Memory only: the gateway is the source, a cold start shows the device's own
 * recents until the first read answers, and nothing here is worth a write.
 */
interface HomeAgentSessionsState {
  byServer: Readonly<Record<string, GatewayAgentSessionsSnapshot>>;
  record: (snapshot: GatewayAgentSessionsSnapshot) => void;
}

export const useHomeAgentSessions = create<HomeAgentSessionsState>((set) => ({
  byServer: {},
  record(snapshot) {
    set((state) => ({ byServer: { ...state.byServer, [snapshot.serverId]: snapshot } }));
  },
}));
