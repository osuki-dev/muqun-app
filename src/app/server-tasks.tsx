import { useLocalSearchParams } from 'expo-router';

import { ServerTasksSheet } from '@/components/server-tasks-sheet';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/**
 * The selected server's task ledger, as a sheet route. Also the deep link
 * `muqun://server-tasks`.
 * `?taskId=` opens straight on that task's detail (Home's task rows).
 */
export default function ServerTasksScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const record = useGatewayConnectionStore((state) => state.record);
  const tasks = useServerTasks(record?.serverId ?? null);
  return (
    <ServerTasksSheet
      serverLabel={record?.label ?? ''}
      state={tasks}
      initialTaskId={typeof taskId === 'string' && taskId ? taskId : undefined}
    />
  );
}
