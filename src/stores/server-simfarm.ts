import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  parseServerSimfarmIndex,
  SERVER_SIMFARM_STORAGE_KEY,
  withSimfarmPort,
  withoutSimfarmServer,
  type ServerSimfarmIndex,
} from '@/lib/server-simfarm';

/**
 * Where simfarm was last found on each server, so it is asked for once.
 *
 * A sibling of `server-web-ports.ts` and written the same way, including the
 * claim-before-read in `hydrate`: two mounts must not both start a read, and a
 * second call must not clobber a `remember` that raced it.
 *
 * The writer is the probe, not the reader. Nobody types a port in the common
 * case -- the app looks on simfarm's own default and finds it -- so this exists
 * for the machine where someone moved it, and it is written by whatever answer
 * actually worked rather than by whatever was typed.
 */
type ServerSimfarmState = {
  hydrated: boolean;
  byServer: ServerSimfarmIndex;
  hydrate: () => Promise<void>;
  /** Writes down the port that just answered on this server. */
  remember: (serverId: string, port: number) => Promise<void>;
  /** Drops a server that is no longer paired. */
  forget: (serverId: string) => Promise<void>;
};

export const useServerSimfarm = create<ServerSimfarmState>((set, get) => ({
  hydrated: false,
  byServer: {},

  async hydrate() {
    if (get().hydrated) return;
    set({ hydrated: true });
    try {
      const raw = await SecureStore.getItemAsync(SERVER_SIMFARM_STORAGE_KEY);
      const stored = parseServerSimfarmIndex(raw);
      // Merged under whatever a racing `remember` already wrote, so a port
      // recorded while the read was in flight survives it.
      set((state) => ({ byServer: { ...stored, ...state.byServer } }));
    } catch {
      // Unreadable storage is the same as none: the probe looks on the default
      // port, which is what an install with no memory does anyway.
    }
  },

  async remember(serverId, port) {
    const next = withSimfarmPort(get().byServer, serverId, port);
    if (next === get().byServer) return;
    set({ byServer: next });
    await write(next);
  },

  async forget(serverId) {
    const next = withoutSimfarmServer(get().byServer, serverId);
    if (next === get().byServer) return;
    set({ byServer: next });
    await write(next);
  },
}));

async function write(index: ServerSimfarmIndex): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVER_SIMFARM_STORAGE_KEY, JSON.stringify(index), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    // A failed write costs one remembered port, which the next successful probe
    // rewrites. Nothing here is worth surfacing to the reader.
  }
}
