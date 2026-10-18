import { create } from 'zustand';

import { createServerTasksState, type ServerTasksState } from '@/lib/server-tasks-state';

/**
 * Each paired server's task ledger as this launch last saw it.
 *
 * In memory only: a task list read off disk at launch would paint "working"
 * for something that finished hours ago. The sheet refreshes on open, and the
 * Home pill reads whatever the last refresh or socket frame left here.
 */
export type { ServerTasksState } from '@/lib/server-tasks-state';

export const useServerTasksStore = create<ServerTasksState>(createServerTasksState());
