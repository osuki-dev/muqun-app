import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { ServerTasksSheet } from '@/components/server-tasks-sheet';
import { TaskResultSheet } from '@/components/task-result-sheet';
import { useHomeCommands } from '@/hooks/use-home-commands';
import { taskRouteFor, useServerTasks } from '@/hooks/use-server-tasks';
import { openTaskWork, taskRowDestination } from '@/lib/home-computer-cards';
import { dismissTaskNotices } from '@/stores/in-app-notifications';
import { showOpeningWhile, taskOpeningKey } from '@/stores/home-task-cards';
import { fetchTaskList } from '@/lib/task-ledger';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * A computer's task ledger, as a sheet route. Also the deep link
 * `muqun://server-tasks`.
 * - `?serverId=` names the computer (Home's cards); the selected one when absent.
 * - `?root=` lists only that task and the work it started.
 * - `?result=` reads a finished command's saved output on this computer.
 */
export default function ServerTasksScreen() {
  const params = useLocalSearchParams<{ serverId?: string; root?: string; result?: string }>();
  const router = useRouter();
  // The sheet closes first, so the session or pane opens where Home would
  // open it; the command must not wait on this route staying focused.
  const commands = useHomeCommands({ sourceRouteActive: () => true });
  const selected = useGatewayConnectionStore((state) => state.record);
  const records = useGatewayConnectionStore((state) => state.records);
  const serverId = params.serverId || selected?.serverId || null;
  const record = records.find((entry) => entry.serverId === serverId) ?? selected;
  const tasks = useServerTasks(serverId);
  const root = typeof params.root === 'string' && params.root ? params.root : undefined;
  const result = typeof params.result === 'string' && params.result ? params.result : undefined;
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

  if (result && serverId) {
    return (
      <TaskResultSheet
        key={`${serverId}/${result}`}
        serverId={serverId}
        taskId={result}
        initialTask={tasks.tasks.find((task) => task.taskId === result)}
        onBack={() => router.setParams({ result: '' })}
        onOpenParent={(parent) => {
          router.back();
          void openTaskWork(commands, serverId, parent);
        }}
      />
    );
  }

  return (
    <ServerTasksSheet
      serverId={serverId}
      serverLabel={record?.label ?? ''}
      state={tasks}
      rootTaskId={root}
      onOpen={(task) => {
        if (!serverId) return;
        dismissTaskNotices(task);
        if (taskRowDestination(task).kind === 'result') {
          // Inspect the saved output in this sheet, without stacking another.
          router.setParams({ result: task.taskId });
          return;
        }
        // Every row opens something (its session, its pane, or its
        // computer), so the sheet always makes way for it.
        router.back();
        showOpeningWhile(
          taskOpeningKey(serverId, task.taskId),
          openTaskWork(commands, serverId, task)
        );
      }}
    />
  );
}
