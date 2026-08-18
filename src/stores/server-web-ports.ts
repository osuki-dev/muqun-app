import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  parseServerWebPortsIndex,
  samePorts,
  SERVER_WEB_PORTS_STORAGE_KEY,
  withMirroredPorts,
  withRecentPort,
  type ServerWebPortsIndex,
} from '@/lib/server-web-ports';

/**
 * Which ports each server has had opened on it, so the sheet can offer them.
 *
 * A store rather than sheet state because the sheet is a route: it is unmounted
 * the moment it closes, and a shortcut that only lasted as long as the sheet was
 * up would never be there the one time it is wanted.
 *
 * Unlike the capability and agent mirrors, nothing polls this -- it is written
 * exactly once per open, by the person opening. So `remember` is the only writer
 * and it is never called with an answer it already holds unless the same port
 * was opened twice in a row.
 */
type ServerWebPortsState = {
  hydrated: boolean;
  byServer: ServerWebPortsIndex;
  hydrate: () => Promise<void>;
  /** Writes down a port that was just opened on this server. */
  remember: (serverId: string, port: number) => Promise<void>;
};

export const useServerWebPorts = create<ServerWebPortsState>((set, get) => ({
  hydrated: false,
  byServer: {},

  async hydrate() {
    if (get().hydrated) return;
    // Claimed before the read so two mounts cannot both start one, and a second
    // call cannot clobber a `remember` that raced it.
    set({ hydrated: true });
    const stored = await loadIndex();
    set((state) => ({ byServer: { ...stored, ...state.byServer } }));
  },

  async remember(serverId, port) {
    if (!serverId) return;
    const ports = withRecentPort(get().byServer[serverId], port);
    // Re-opening the same port on top of the list is the common case and moves
    // nothing; it is not worth a keychain write.
    if (samePorts(get().byServer[serverId], ports)) return;
    const byServer = withMirroredPorts(get().byServer, serverId, ports);
    set({ byServer });
    await saveIndex(byServer);
  },
}));

async function loadIndex(): Promise<ServerWebPortsIndex> {
  try {
    const value = await SecureStore.getItemAsync(SERVER_WEB_PORTS_STORAGE_KEY);
    return value ? parseServerWebPortsIndex(value) : {};
  } catch {
    return {};
  }
}

async function saveIndex(index: ServerWebPortsIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_WEB_PORTS_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // The in-memory list still drives this launch; only the next cold start
    // loses the shortcut, and opening the port again writes it back.
  }
}
