import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import { keptUnpairs, type UnpairProgress, type UnpairRecord } from '@/lib/fleet-peers';

/**
 * What this device's own unpairings left unfinished (A5 D6): computers that
 * were down, or refused, when this device took a computer it unpaired off
 * them, and computers the unpaired one still lists. Persisted, so a computer
 * asleep at unpair time is cleaned the next time it answers, once.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const KEY = 'muqun.fleet.unpairs.v1';

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: 'muqun.fleet' });
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

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

function load(): UnpairRecord[] {
  try {
    const value: unknown = JSON.parse(storage.getString(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is UnpairRecord =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as UnpairRecord).serverId === 'string' &&
          typeof (entry as UnpairRecord).atMs === 'number' &&
          Array.isArray((entry as UnpairRecord).pending) &&
          Array.isArray((entry as UnpairRecord).stillListedBy)
      )
      .map((entry) => {
        // A progress map this build cannot read restarts its steps, it does not crash them.
        const progress = Object.fromEntries(
          Object.entries(
            typeof entry.progress === 'object' && entry.progress ? entry.progress : {}
          ).filter(
            ([, item]) =>
              typeof item === 'object' &&
              item !== null &&
              Array.isArray(item.done) &&
              typeof item.failures === 'number'
          )
        );
        const { progress: _held, ...rest } = entry;
        return Object.keys(progress).length ? { ...rest, progress } : rest;
      });
  } catch {
    return [];
  }
}

function save(entries: readonly UnpairRecord[]): void {
  try {
    storage.set(KEY, JSON.stringify(entries));
  } catch {
    // Memory still holds them for this launch.
  }
}

type FleetUnpairsState = {
  entries: UnpairRecord[];
  /** Replace the record for its computer (one unpairing just finished its first round). */
  put: (entry: UnpairRecord) => void;
  /** `serverId`'s cleanup on `computerId` is confirmed done: it is no longer pending. */
  settle: (serverId: string, computerId: string) => void;
  /** How the cleanup on `computerId` stands, while it is still pending. */
  setProgress: (serverId: string, computerId: string, progress: UnpairProgress | undefined) => void;
  /** Drop what is done, old, or about a computer this device paired again. */
  prune: (pairedIds: readonly string[], nowMs: number) => void;
};

export const useFleetUnpairs = create<FleetUnpairsState>((set, get) => ({
  entries: load(),
  put: (entry) => {
    const entries = [...get().entries.filter((item) => item.serverId !== entry.serverId), entry];
    save(entries);
    set({ entries });
  },
  settle: (serverId, computerId) => {
    const entries = get().entries.map((item) =>
      item.serverId === serverId
        ? {
            ...item,
            pending: item.pending.filter((id) => id !== computerId),
            ...(item.progress ? { progress: withoutKey(item.progress, computerId) } : {}),
          }
        : item
    );
    save(entries);
    set({ entries });
  },
  setProgress: (serverId, computerId, progress) => {
    const entries = get().entries.map((item) => {
      if (item.serverId !== serverId) return item;
      const rest = withoutKey(item.progress ?? {}, computerId);
      return { ...item, progress: progress ? { ...rest, [computerId]: progress } : rest };
    });
    save(entries);
    set({ entries });
  },
  prune: (pairedIds, nowMs) => {
    const current = get().entries;
    const entries = keptUnpairs(current, pairedIds, nowMs);
    if (entries.length === current.length) return;
    save(entries);
    set({ entries });
  },
}));
