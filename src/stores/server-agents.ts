import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  keepMirroredServers,
  normalizeServerAgents,
  parseServerAgentsIndex,
  sameServerAgents,
  SERVER_AGENTS_STORAGE_KEY,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from '@/lib/server-agents';

/**
 * The home screen's view of what every paired server was last running.
 *
 * Held in a store rather than fetched by the list because the writer and the
 * reader are different screens: `/servers/[serverId]` sees the agents, the
 * server list draws them, and neither should have to know about the other.
 */
type ServerAgentsState = {
  hydrated: boolean;
  byServer: ServerAgentsIndex;
  hydrate: () => Promise<void>;
  /** Writes down what the server screen just saw. */
  record: (snapshot: ServerAgentsSnapshot) => Promise<void>;
  /** Drops snapshots for servers this device no longer has. */
  keepOnly: (serverIds: readonly string[]) => Promise<void>;
};

export const useServerAgents = create<ServerAgentsState>((set, get) => ({
  hydrated: false,
  byServer: {},

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two screens mounting together cannot both
    // start one, and a second call cannot clobber a `record` that raced it.
    set({ hydrated: true });
    const stored = await loadServerAgentsIndex();
    set((state) => ({ byServer: { ...stored, ...state.byServer } }));
  },

  async record(snapshot) {
    const next = normalizeServerAgents(snapshot);
    const previous = get().byServer[next.serverId];
    // An unchanged list still gets a fresh timestamp in memory -- that is what
    // keeps the card saying "seen just now" -- but only a real change is worth
    // a keychain write.
    const changed = !sameServerAgents(previous, next);
    const byServer = { ...get().byServer, [next.serverId]: next };
    set({ byServer });
    if (changed) await saveServerAgentsIndex(byServer);
  },

  async keepOnly(serverIds) {
    const byServer = keepMirroredServers(get().byServer, serverIds);
    if (Object.keys(byServer).length === Object.keys(get().byServer).length) return;
    set({ byServer });
    await saveServerAgentsIndex(byServer);
  },
}));

async function loadServerAgentsIndex(): Promise<ServerAgentsIndex> {
  try {
    const value = await SecureStore.getItemAsync(SERVER_AGENTS_STORAGE_KEY);
    return value ? parseServerAgentsIndex(value) : {};
  } catch {
    // A list that cannot read the mirror shows plain cards, which is what it
    // showed before this feature existed. There is nothing to report.
    return {};
  }
}

async function saveServerAgentsIndex(index: ServerAgentsIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_AGENTS_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // Freshness is the only casualty: the in-memory index still drives the
    // list for the rest of this launch.
  }
}
