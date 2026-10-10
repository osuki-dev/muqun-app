import { create } from 'zustand';

import type { ActiveServerConnection } from '@/lib/server-reachability';

/**
 * The connection the open terminal workspace holds, for screens it presents
 * over itself (a guide sheet on the Pad) that resolve a computer's status:
 * the same `activeConnection` Home is handed. Unset while no workspace is up.
 */
export const useActiveConnection = create<{
  connection: ActiveServerConnection | undefined;
  set: (connection: ActiveServerConnection | undefined) => void;
}>((set) => ({
  connection: undefined,
  set: (connection) =>
    set((state) =>
      state.connection?.serverId === connection?.serverId &&
      state.connection?.phase === connection?.phase
        ? state
        : { connection }
    ),
}));
