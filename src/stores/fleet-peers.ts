import { create } from 'zustand';

import {
  failureKey,
  refusesPhone,
  type FleetPeers,
  type FleetPeersFetch,
  type NameConflict,
} from '@/lib/fleet-peers';

/** How the last `GET /api/peers` to a computer went, without the answer itself. */
export type FleetFetchStatus = 'ok' | 'network' | 'parse' | number;

export function fetchStatus(result: FleetPeersFetch): FleetFetchStatus {
  return result.ok ? 'ok' : result.reason === 'http' ? result.status : result.reason;
}

/** Two answers that say the same thing, so a run that learns nothing writes nothing. */
function samePeers(a: FleetPeers | undefined, b: FleetPeers): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** What each computer last said about its links, and which links failed when. Memory only. */
type FleetPeersState = {
  byServer: Record<string, FleetPeers>;
  /** How the last read of each computer went. */
  statusByServer: Record<string, FleetFetchStatus>;
  /** `failureKey(from, to)` → when linking (or moving, `to` a peer id) last failed. */
  failures: Record<string, number>;
  /** `failureKey(from, to)` → the names that kept that link from being made. */
  conflicts: Record<string, NameConflict>;
  lastRunMs: number;
  setPeers: (serverId: string, peers: FleetPeers) => void;
  /** Record a read: its answer when there was one; a refusal of this phone forgets the last one. */
  record: (serverId: string, result: FleetPeersFetch) => void;
  fail: (from: string, to: string, atMs: number) => void;
  succeed: (from: string, to: string) => void;
  conflict: (from: string, to: string, conflict: NameConflict) => void;
  clearConflict: (key: string) => void;
  ran: (atMs: number) => void;
  /** Drop everything about computers no longer paired (or no longer linkable). */
  keepOnly: (serverIds: readonly string[]) => void;
};

export const useFleetPeers = create<FleetPeersState>((set, get) => ({
  byServer: {},
  statusByServer: {},
  failures: {},
  conflicts: {},
  lastRunMs: 0,
  setPeers: (serverId, peers) =>
    set((state) =>
      samePeers(state.byServer[serverId], peers)
        ? state
        : { byServer: { ...state.byServer, [serverId]: peers } }
    ),
  record: (serverId, result) => {
    if (__DEV__ && !result.ok) {
      console.warn('[fleet] GET /api/peers', serverId, fetchStatus(result));
    }
    set((state) => {
      const status = fetchStatus(result);
      const statusByServer =
        state.statusByServer[serverId] === status
          ? state.statusByServer
          : { ...state.statusByServer, [serverId]: status };
      if (result.ok) {
        if (samePeers(state.byServer[serverId], result.peers)) return { statusByServer };
        return { statusByServer, byServer: { ...state.byServer, [serverId]: result.peers } };
      }
      if (!refusesPhone(result) || !(serverId in state.byServer)) return { statusByServer };
      const { [serverId]: _forgotten, ...byServer } = state.byServer;
      return { statusByServer, byServer };
    });
  },
  fail: (from, to, atMs) =>
    set((state) => ({ failures: { ...state.failures, [failureKey(from, to)]: atMs } })),
  succeed: (from, to) =>
    set((state) => {
      const key = failureKey(from, to);
      if (!(key in state.failures)) return state;
      const { [key]: _dropped, ...failures } = state.failures;
      return { failures };
    }),
  conflict: (from, to, conflict) =>
    set((state) => ({ conflicts: { ...state.conflicts, [failureKey(from, to)]: conflict } })),
  clearConflict: (key) =>
    set((state) => {
      if (!(key in state.conflicts)) return state;
      const { [key]: _dropped, ...conflicts } = state.conflicts;
      return { conflicts };
    }),
  ran: (atMs) => set({ lastRunMs: atMs }),
  keepOnly: (serverIds) =>
    set((state) => {
      const kept = new Set(serverIds);
      // The same object when nothing is dropped, so a run that changes
      // nothing re-renders nothing.
      const filtered = <T>(entries: Record<string, T>, idOf: (key: string) => string) => {
        const left = Object.entries(entries).filter(([key]) => kept.has(idOf(key)));
        return left.length === Object.keys(entries).length ? entries : Object.fromEntries(left);
      };
      const keep = <T>(entries: Record<string, T>) => filtered(entries, (serverId) => serverId);
      // A failure belongs to the computer that tried (`from`).
      const byFrom = <T>(entries: Record<string, T>) =>
        filtered(entries, (key) => key.split('\n')[0] ?? '');
      return {
        byServer: keep(state.byServer),
        statusByServer: keep(state.statusByServer),
        failures: byFrom(state.failures),
        conflicts: byFrom(state.conflicts),
      };
    }),
}));
