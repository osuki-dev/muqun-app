import { create } from 'zustand';
import { projectHomeTasks } from '@/lib/home-summary';
import { useHomeSummary } from './home-summary';
import { useServerTasksStore } from './server-tasks';

/** All Home layouts and subtitles share this projection; detail writes stay in the ledger. */
export const useHomeTasksStore = create(() => useServerTasksStore.getState());
function project() {
  const direct = useServerTasksStore.getState();
  const { summaries, live } = useHomeSummary.getState();
  const index = projectHomeTasks(direct.index, summaries, live, useHomeTasksStore.getState().index);
  const previous = useHomeTasksStore.getState();
  if (index !== previous.index || direct.defaultCwd !== previous.defaultCwd)
    useHomeTasksStore.setState({ ...direct, index });
}
useServerTasksStore.subscribe(project);
useHomeSummary.subscribe(project);
