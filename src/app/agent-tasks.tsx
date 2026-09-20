import { useRouter } from 'expo-router';

import { AgentTasksSheet } from '@/components/agent-tasks-sheet';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/** The task-list sheet's route. The list itself lives in the sheet bridge. */
export default function AgentTasksScreen() {
  const router = useRouter();
  const todos = useAgentSheetBridge((state) => state.todos);
  return <AgentTasksSheet items={todos} onClose={() => router.back()} />;
}
