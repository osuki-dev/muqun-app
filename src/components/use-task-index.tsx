import { useShallow } from 'zustand/react/shallow';

import type { ServerTasksIndex } from '@/lib/server-tasks-state';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * The task ledger of just these computers, so a frame for another computer
 * does not re-render the rows that read it.
 */
export function useTaskIndexFor(serverIds: readonly string[]): ServerTasksIndex {
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  const index: ServerTasksIndex = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  return index;
}
