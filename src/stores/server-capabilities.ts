import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  normalizeCapabilities,
  parseServerCapabilitiesIndex,
  sameCapabilities,
  SERVER_CAPABILITIES_STORAGE_KEY,
  withMirroredCapabilities,
  type ServerCapabilitiesIndex,
} from '@/lib/server-capabilities';

/**
 * The home screen's view of what every paired gateway can do.
 *
 * Held in a store for the same reason as the agent mirror: the writer and the
 * reader are different screens. `/servers/[serverId]` gets the capability list
 * with every health answer, the home card's menu gates an entry on it, and
 * neither should have to know about the other.
 */
type ServerCapabilitiesState = {
  hydrated: boolean;
  byServer: ServerCapabilitiesIndex;
  hydrate: () => Promise<void>;
  /** Writes down what `/health` just said. */
  record: (serverId: string, capabilities: unknown) => Promise<void>;
};

export const useServerCapabilities = create<ServerCapabilitiesState>((set, get) => ({
  hydrated: false,
  byServer: {},

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two screens mounting together cannot both
    // start one, and a second call cannot clobber a `record` that raced it.
    set({ hydrated: true });
    const stored = await loadIndex();
    set((state) => ({ byServer: { ...stored, ...state.byServer } }));
  },

  async record(serverId, capabilities) {
    if (!serverId) return;
    const names = normalizeCapabilities(capabilities);
    // The server screen polls, so this is called with the same answer over and
    // over; only a real change is worth a keychain write.
    if (sameCapabilities(get().byServer[serverId], names)) return;
    const byServer = withMirroredCapabilities(get().byServer, serverId, names);
    set({ byServer });
    await saveIndex(byServer);
  },
}));

async function loadIndex(): Promise<ServerCapabilitiesIndex> {
  try {
    const value = await SecureStore.getItemAsync(SERVER_CAPABILITIES_STORAGE_KEY);
    return value ? parseServerCapabilitiesIndex(value) : {};
  } catch {
    return {};
  }
}

async function saveIndex(index: ServerCapabilitiesIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_CAPABILITIES_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The in-memory index still drives this launch; only the next cold start
    // loses the answer, and opening the server writes it again.
  }
}
