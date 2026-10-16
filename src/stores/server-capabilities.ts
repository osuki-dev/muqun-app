import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  envelopeCapabilityNames,
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
  /**
   * What the content envelopes of a server's agent-session routes have said
   * they can do (`envelopeCapabilityNames`). Kept across launches beside
   * `byServer`, so a session's first open after a launch already knows it
   * may read the subtree in one request. Separate from `byServer`, which is
   * the `/health` list and is replaced whole by every health answer.
   */
  observed: ServerCapabilitiesIndex;
  hydrate: () => Promise<void>;
  /** Writes down what `/health` just said. */
  record: (serverId: string, capabilities: unknown) => Promise<void>;
  /** Notes what a content envelope's `capabilities` object switched on. */
  observe: (serverId: string | null | undefined, capabilities: unknown) => void;
};

export const useServerCapabilities = create<ServerCapabilitiesState>((set, get) => ({
  hydrated: false,
  byServer: {},
  observed: {},

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two screens mounting together cannot both
    // start one, and a second call cannot clobber a `record` that raced it.
    set({ hydrated: true });
    const [stored, observed] = await Promise.all([loadIndex(), loadObserved()]);
    set((state) => ({
      byServer: { ...stored, ...state.byServer },
      observed: { ...observed, ...state.observed },
    }));
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

  observe(serverId, capabilities) {
    if (!serverId) return;
    const names = envelopeCapabilityNames(capabilities);
    const known = get().observed[serverId] ?? [];
    const added = names.filter((name) => !known.includes(name));
    // Only ever grows within a launch: an envelope that happens not to carry
    // the object -- an older route, an error body -- is not the gateway
    // taking a capability back.
    if (added.length === 0) return;
    const observed = { ...get().observed, [serverId]: [...known, ...added] };
    set({ observed });
    void saveObserved(observed);
  },
}));

const OBSERVED_STORAGE_KEY = `${SERVER_CAPABILITIES_STORAGE_KEY}.observed`;

async function loadObserved(): Promise<ServerCapabilitiesIndex> {
  try {
    const value = await SecureStore.getItemAsync(OBSERVED_STORAGE_KEY);
    return value ? parseServerCapabilitiesIndex(value) : {};
  } catch {
    return {};
  }
}

async function saveObserved(index: ServerCapabilitiesIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(OBSERVED_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The in-memory index still drives this launch; the next one learns it
    // again from the first envelope.
  }
}

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
