import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import { failureKey, refusesPhone, type FleetPeers, type FleetPeersFetch } from '@/lib/fleet-peers';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.fleet';
const TOMBSTONES_KEY = 'muqun.fleet.unpaired.v1';

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

const storage = openStore();

function loadTombstones(): string[] {
  try {
    const value: unknown = JSON.parse(storage.getString(TOMBSTONES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveTombstones(ids: readonly string[]): void {
  try {
    storage.set(TOMBSTONES_KEY, JSON.stringify(ids));
  } catch {
    // Memory still drives this launch; the next run retries the cleanup anyway.
  }
}

/** How the last `GET /api/peers` to a computer went, without the answer itself. */
export type FleetFetchStatus = 'ok' | 'network' | 'parse' | number;

export function fetchStatus(result: FleetPeersFetch): FleetFetchStatus {
  return result.ok ? 'ok' : result.reason === 'http' ? result.status : result.reason;
}

/**
 * What each computer last said about its links, and which links failed when.
 * Memory only, except the computers the phone unpaired whose peer rows some
 * other computer may still hold (`tombstones`), which survive a restart until
 * every other computer has let them go.
 */
type FleetPeersState = {
  byServer: Record<string, FleetPeers>;
  /** How the last read of each computer went. */
  statusByServer: Record<string, FleetFetchStatus>;
  /** `failureKey(from, to)` → when linking (or renaming, `to` a peer id) last failed. */
  failures: Record<string, number>;
  lastRunMs: number;
  /** Server ids unpaired from this phone, not yet gone from every other computer. */
  tombstones: string[];
  setPeers: (serverId: string, peers: FleetPeers) => void;
  /** Record a read: its answer when there was one; a refusal of this phone forgets the last one. */
  record: (serverId: string, result: FleetPeersFetch) => void;
  fail: (from: string, to: string, atMs: number) => void;
  succeed: (from: string, to: string) => void;
  ran: (atMs: number) => void;
  /** Drop everything about computers no longer paired (or no longer linkable). */
  keepOnly: (serverIds: readonly string[]) => void;
  bury: (serverId: string) => void;
  unbury: (serverIds: readonly string[]) => void;
};

export const useFleetPeers = create<FleetPeersState>((set, get) => ({
  byServer: {},
  statusByServer: {},
  failures: {},
  lastRunMs: 0,
  tombstones: loadTombstones(),
  setPeers: (serverId, peers) =>
    set((state) => ({ byServer: { ...state.byServer, [serverId]: peers } })),
  record: (serverId, result) => {
    if (__DEV__ && !result.ok) {
      console.warn('[fleet] GET /api/peers', serverId, fetchStatus(result));
    }
    set((state) => {
      const statusByServer = { ...state.statusByServer, [serverId]: fetchStatus(result) };
      if (result.ok) {
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
  ran: (atMs) => set({ lastRunMs: atMs }),
  keepOnly: (serverIds) =>
    set((state) => {
      const kept = new Set(serverIds);
      const keep = <T>(entries: Record<string, T>) =>
        Object.fromEntries(Object.entries(entries).filter(([serverId]) => kept.has(serverId)));
      // A failure belongs to the computer that tried (`from`).
      const failures = Object.fromEntries(
        Object.entries(state.failures).filter(([key]) => kept.has(key.split('\n')[0] ?? ''))
      );
      return {
        byServer: keep(state.byServer),
        statusByServer: keep(state.statusByServer),
        failures,
      };
    }),
  bury: (serverId) => {
    if (get().tombstones.includes(serverId)) return;
    const tombstones = [...get().tombstones, serverId];
    saveTombstones(tombstones);
    set({ tombstones });
  },
  unbury: (serverIds) => {
    const drop = new Set(serverIds);
    const tombstones = get().tombstones.filter((id) => !drop.has(id));
    if (tombstones.length === get().tombstones.length) return;
    saveTombstones(tombstones);
    set({ tombstones });
  },
}));
