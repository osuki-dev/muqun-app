import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  keepRecentlyViewedServers,
  parseServerLastViewedIndex,
  SERVER_LAST_VIEWED_STORAGE_KEY,
  type ServerLastViewedIndex,
} from '@/lib/away-digest';

/**
 * When each paired server was last on screen, which is the only input the
 * "while you were away" digest has that the gateway cannot supply: the gateway
 * knows what its agents did, and only the phone knows whether anybody was
 * watching.
 *
 * Stored the way the agent mirror is (`stores/server-agents`) -- a per-server
 * index in the keychain, hydrated once, written on change -- rather than in
 * MMKV. Not because a timestamp is a secret, but because it is read exactly
 * once per server visit, in an effect that is already async, and one storage
 * mechanism for per-server prefs is worth more than a marginally faster read.
 */
type ServerLastViewedState = {
  hydrated: boolean;
  byServer: ServerLastViewedIndex;
  hydrate: () => Promise<void>;
  /**
   * Marks this server as being on screen right now, and hands back the mark it
   * replaced -- `null` for a server never opened before.
   *
   * Read and write in one call on purpose. The digest is built from the *old*
   * mark and must never be built twice from the same one: a screen that read
   * the mark, awaited a fetch, and then wrote a new one would raise the same
   * card again on a remount mid-flight. Swapping here makes the window
   * single-use, so at worst a remount shows nothing rather than showing
   * yesterday's news a second time.
   */
  visit: (serverId: string, atMs?: number) => Promise<number | null>;
  /** Drops marks for servers this device no longer has. */
  keepOnly: (serverIds: readonly string[]) => Promise<void>;
};

export const useServerLastViewed = create<ServerLastViewedState>((set, get) => ({
  hydrated: false,
  byServer: {},

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two screens mounting together cannot both
    // start one, and a second call cannot clobber a `visit` that raced it.
    set({ hydrated: true });
    const stored = await loadIndex();
    // Anything written during the read wins: it describes this second, and the
    // stored copy describes the last launch.
    set((state) => ({ byServer: { ...stored, ...state.byServer } }));
  },

  async visit(serverId, atMs = Date.now()) {
    if (!serverId) return null;
    await get().hydrate();
    const previous = get().byServer[serverId] ?? null;
    const byServer = { ...get().byServer, [serverId]: atMs };
    set({ byServer });
    await saveIndex(byServer);
    return previous;
  },

  async keepOnly(serverIds) {
    const byServer = keepRecentlyViewedServers(get().byServer, serverIds);
    if (Object.keys(byServer).length === Object.keys(get().byServer).length) return;
    set({ byServer });
    await saveIndex(byServer);
  },
}));

async function loadIndex(): Promise<ServerLastViewedIndex> {
  try {
    const value = await SecureStore.getItemAsync(SERVER_LAST_VIEWED_STORAGE_KEY);
    return value ? parseServerLastViewedIndex(value) : {};
  } catch {
    // No marks means no digest, which is what the app did before this feature
    // existed. There is nothing to report to the user about it.
    return {};
  }
}

async function saveIndex(index: ServerLastViewedIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_LAST_VIEWED_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The in-memory mark still drives the rest of this launch; the only
    // casualty is that a relaunch forgets when this server was last opened.
  }
}
