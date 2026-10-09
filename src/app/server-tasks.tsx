import { ServerTasksSheet } from '@/components/server-tasks-sheet';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/**
 * The selected server's task ledger, as a sheet route. Also the deep link
 * `muqun://server-tasks`, which in the demo opens the demo server's tasks.
 */
export default function ServerTasksScreen() {
  const record = useGatewayConnectionStore((state) => state.record);
  const tasks = useServerTasks(record?.serverId ?? null);
  return <ServerTasksSheet serverLabel={record?.label ?? ''} state={tasks} />;
}
