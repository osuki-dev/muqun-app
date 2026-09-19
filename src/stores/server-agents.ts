import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { parseServerAgentsIndex, SERVER_AGENTS_STORAGE_KEY } from '@/lib/server-agents';
import { createServerAgentsState, type ServerAgentsState } from '@/lib/server-agents-state';

/**
 * The home screen's view of what every paired server was last running.
 *
 * Held in a store rather than fetched by the list because the writer and the
 * reader are different screens: `/servers/[serverId]` sees the agents, the
 * server list draws them, and neither should have to know about the other.
 */
export type { ServerAgentsState } from '@/lib/server-agents-state';

export const useServerAgents = create<ServerAgentsState>(
  createServerAgentsState({
    load: async () => {
      const value = await SecureStore.getItemAsync(SERVER_AGENTS_STORAGE_KEY);
      return value ? parseServerAgentsIndex(value) : {};
    },
    save: (index) =>
      SecureStore.setItemAsync(SERVER_AGENTS_STORAGE_KEY, JSON.stringify(index), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
  })
);
