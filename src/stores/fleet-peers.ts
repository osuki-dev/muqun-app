import { create } from 'zustand';

import { failureKey, type FleetPeers } from '@/lib/fleet-peers';

/**
 * What each computer last said about its links, and which links failed when.
 * Memory only: the reconciler reads every computer again on its next run.
 */
type FleetPeersState = {
  byServer: Record<string, FleetPeers>;
  /** `failureKey(from, to)` → when linking `from` to `to` last failed. */
  failures: Record<string, number>;
  lastRunMs: number;
  setPeers: (serverId: string, peers: FleetPeers) => void;
  fail: (from: string, to: string, atMs: number) => void;
  succeed: (from: string, to: string) => void;
  ran: (atMs: number) => void;
  /** Drop everything about computers no longer paired (or no longer linkable). */
  keepOnly: (serverIds: readonly string[]) => void;
};

export const useFleetPeers = create<FleetPeersState>((set) => ({
  byServer: {},
  failures: {},
  lastRunMs: 0,
  setPeers: (serverId, peers) =>
    set((state) => ({ byServer: { ...state.byServer, [serverId]: peers } })),
  fail: (from, to, atMs) =>
    set((state) => ({ failures: { ...state.failures, [failureKey(from, to)]: atMs } })),
  succeed: (from, to) =>
    set((state) => {
      const key = failureKey(from, to);
      if (!(key in state.failures)) return state;
      const { [key]: _dropped, ...failures } = state.failures;
      return { failures };
    }),
  ran: (atMs) => set({ lastRunMs: atMs }),
  keepOnly: (serverIds) =>
    set((state) => {
      const kept = new Set(serverIds);
      const byServer = Object.fromEntries(
        Object.entries(state.byServer).filter(([serverId]) => kept.has(serverId))
      );
      const failures = Object.fromEntries(
        Object.entries(state.failures).filter(([key]) =>
          key.split('\n').every((serverId) => kept.has(serverId))
        )
      );
      return { byServer, failures };
    }),
}));
