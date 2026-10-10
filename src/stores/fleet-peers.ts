import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import {
  failureKey,
  keptTombstones,
  refusesPhone,
  type Tombstone,
  type FleetPeers,
  type FleetPeersFetch,
} from '@/lib/fleet-peers';

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

/** Entries as stored; a bare id (the first format) counts as unpaired now. */
function loadTombstones(): Tombstone[] {
  try {
    const value: unknown = JSON.parse(storage.getString(TOMBSTONES_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const nowMs = Date.now();
    const entries = value.flatMap((entry: unknown): Tombstone[] => {
      if (typeof entry === 'string') return [{ serverId: entry, buriedAtMs: nowMs }];
      const rec = entry as Partial<Tombstone> | null;
      return typeof rec?.serverId === 'string' && typeof rec.buriedAtMs === 'number'
        ? [{ serverId: rec.serverId, buriedAtMs: rec.buriedAtMs }]
        : [];
    });
    return keptTombstones(entries, nowMs);
  } catch {
    return [];
  }
}

function saveTombstones(entries: readonly Tombstone[]): void {
  try {
    storage.set(TOMBSTONES_KEY, JSON.stringify(entries));
  } catch {
    // Memory still drives this launch; the next run retries the cleanup anyway.
  }
}

function withTombstones(entries: Tombstone[]) {
  saveTombstones(entries);
  return { tombstones: entries };
}

const initialBuried = loadTombstones();

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
  /** Computers unpaired from this phone, and when, not yet gone from every other computer. */
  tombstones: Tombstone[];
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
  tombstones: initialBuried,
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
    if (get().tombstones.some((entry) => entry.serverId === serverId)) return;
    const nowMs = Date.now();
    set(
      withTombstones(keptTombstones([...get().tombstones, { serverId, buriedAtMs: nowMs }], nowMs))
    );
  },
  unbury: (serverIds) => {
    const drop = new Set(serverIds);
    const kept = get().tombstones.filter((entry) => !drop.has(entry.serverId));
    if (kept.length === get().tombstones.length) return;
    set(withTombstones(kept));
  },
}));
