import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { ServerTasksSheet } from '@/components/server-tasks-sheet';
import { taskRouteFor, useServerTasks } from '@/hooks/use-server-tasks';
import { fetchTaskList } from '@/lib/task-ledger';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * A computer's task ledger, as a sheet route. Also the deep link
 * `muqun://server-tasks`.
 * - `?serverId=` names the computer (Home's cards); the selected one when absent.
 * - `?taskId=` opens straight on that task's detail.
 * - `?root=` lists only that task and the work it started.
 */
export default function ServerTasksScreen() {
  const params = useLocalSearchParams<{ taskId?: string; serverId?: string; root?: string }>();
  const selected = useGatewayConnectionStore((state) => state.record);
  const records = useGatewayConnectionStore((state) => state.records);
  const serverId = params.serverId || selected?.serverId || null;
  const record = records.find((entry) => entry.serverId === serverId) ?? selected;
  const tasks = useServerTasks(serverId);
  const root = typeof params.root === 'string' && params.root ? params.root : undefined;
  const upsert = useServerTasksStore((state) => state.upsert);

  // The whole tree under the root, which may reach past the page the list read.
  useEffect(() => {
    if (!root || !serverId) return;
    const route = taskRouteFor(serverId);
    if (!route) return;
    let current = true;
    void fetchTaskList({
      root,
      limit: 200,
      ...(route.kind === 'endpoint' ? { endpoint: route.endpoint } : {}),
    }).then((list) => {
      if (!current || !list) return;
      for (const task of list) upsert(serverId, task);
    });
    return () => {
      current = false;
    };
  }, [root, serverId, upsert]);

  return (
    <ServerTasksSheet
      serverId={serverId}
      serverLabel={record?.label ?? ''}
      state={tasks}
      rootTaskId={root}
      initialTaskId={typeof params.taskId === 'string' && params.taskId ? params.taskId : undefined}
    />
  );
}
