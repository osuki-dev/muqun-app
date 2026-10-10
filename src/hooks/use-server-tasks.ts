import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useLingui } from '@lingui/react/macro';

import { isDemoActive, isDemoRecord } from '@/lib/demo-gateway';
import { configuredGatewayServerId } from '@/lib/gateway-client';
import { WS_EVENTS_CAPABILITY, type GatewaySocketState } from '@/lib/gateway-socket';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import { applyListAnswer, isTaskChannelLive, sessionsLeftWaiting } from '@/lib/server-tasks-state';
import {
  cancelTask,
  completeTask,
  fetchTaskDefaultCwd,
  fetchTaskList,
  TASK_DEFAULTS_CAPABILITY,
  TASK_WS_SUBSCRIPTION_CAPABILITY,
  type TaskEndpoint,
  type TaskView,
} from '@/lib/task-ledger';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useInAppNotifications } from '@/stores/in-app-notifications';
import { useServerTasksStore } from '@/stores/server-tasks';

const NO_TASKS: TaskView[] = [];

/**
 * Apply a ledger update for `serverId`, then retire the question notices
 * ("Agent blocked") of sessions whose task left `waiting` in it: answered,
 * working again, or finished.
 */
function settlingQuestions(serverId: string, update: () => void): void {
  const tasksOf = () => useServerTasksStore.getState().index[serverId]?.tasks ?? NO_TASKS;
  const before = tasksOf();
  update();
  const notices = useInAppNotifications.getState();
  for (const asid of sessionsLeftWaiting(before, tasksOf())) notices.dismissQuestions(asid);
}

/** How a computer's ledger is reached from here, if at all. */
export function taskRouteFor(
  serverId: string
): { kind: 'shared' } | { kind: 'endpoint'; endpoint: TaskEndpoint } | null {
  if (configuredGatewayServerId() === serverId) return { kind: 'shared' };
  const record = useGatewayConnectionStore
    .getState()
    .records.find((entry) => entry.serverId === serverId);
  if (!record || record.sshTunnel || isDemoRecord(record)) return null;
  return {
    kind: 'endpoint',
    endpoint: {
      url: record.url,
      token: record.token,
      ...(record.deviceId ? { deviceId: record.deviceId } : {}),
      ...(record.transportKey ? { transportKey: record.transportKey } : {}),
      ...(record.transport ? { transport: record.transport } : {}),
    },
  };
}
const noSubscription = () => () => {};

export type ServerTasks = {
  tasks: TaskView[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Whether changes arrive by themselves; false means "updates when you reopen". */
  live: boolean;
};

/**
 * A paired computer's task ledger: fetched on mount and whenever the app
 * returns to the foreground, and kept current by `task.updated` frames while
 * the gateway's socket is open.
 *
 * The HTTP refresh is never skipped for the socket's sake. A gateway without
 * `ws_events`, the demo, or a socket closed in the background all still get a
 * list that is true as of the moment the sheet opened (review focus 1).
 */
export function useServerTasks(serverId: string | null): ServerTasks {
  const tasks = useServerTasksStore((state) =>
    serverId ? (state.index[serverId]?.tasks ?? NO_TASKS) : NO_TASKS
  );
  const replace = useServerTasksStore((state) => state.replace);
  const upsert = useServerTasksStore((state) => state.upsert);
  const setDefaultCwd = useServerTasksStore((state) => state.setDefaultCwd);
  const wsEvents = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId]?.includes(WS_EVENTS_CAPABILITY) === true : false
  );
  // Task frames alone, without every session's traffic, where the gateway can.
  const tasksOnly = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId]?.includes(TASK_WS_SUBSCRIPTION_CAPABILITY) === true : false
  );
  // Where its next task runs, on a gateway that says so.
  const reportsDefaults = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId]?.includes(TASK_DEFAULTS_CAPABILITY) === true : false
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A slower answer for an earlier request must not overwrite a newer one. */
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    // The selected computer is asked through the shared client; any other one
    // through its own stored address, so its tasks are filed under its own id.
    // A computer reached only through an SSH tunnel is not asked from here.
    const route = serverId ? taskRouteFor(serverId) : null;
    if (!serverId || !route) {
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    const requestedAtMs = Date.now();
    setLoading(true);
    const endpoint = route.kind === 'endpoint' ? route.endpoint : undefined;
    const query = { limit: 100, ...(endpoint ? { endpoint } : {}) };
    // The default folder too: only a task-only socket hears `defaults`
    // frames, and the selected computer's socket may carry its sessions as
    // well. A failed read leaves what was last said.
    if (reportsDefaults) {
      void fetchTaskDefaultCwd(endpoint).then((cwd) => {
        if (cwd && request === requestRef.current) setDefaultCwd(serverId, cwd);
      });
    }
    try {
      const list = await fetchTaskList(query);
      if (request !== requestRef.current) return;
      // A failed read keeps the list already held and says so.
      applyListAnswer(list, {
        replace: (tasks) =>
          settlingQuestions(serverId, () => replace(serverId, tasks, requestedAtMs)),
        ok: () => setError(null),
        fail: () => setError('unavailable'),
      });
    } catch (failure) {
      if (request !== requestRef.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    if (request === requestRef.current) setLoading(false);
  }, [serverId, replace, setDefaultCwd, reportsDefaults]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      subscription.remove();
      // Discard an answer that lands after this effect is gone.
      requestRef.current += 1;
    };
  }, [refresh]);

  const demo = isDemoActive();
  // One socket per computer: the selected one's is the workbench's own, and
  // any other is the same class opened against the stored record, carrying
  // task frames only (nothing else listens to it).
  const socket =
    serverId && wsEvents && !demo && taskRouteFor(serverId) ? gatewaySocketFor(serverId) : null;

  useEffect(() => {
    if (!socket || !serverId) return;
    return socket.watchTasks(
      {
        onTaskUpdated: (task) => settlingQuestions(serverId, () => upsert(serverId, task)),
        // After every (re)connect: whatever changed while it was down.
        onSubscribed: () => void refresh(),
        // The gateway dropped frames for this socket; a task may have changed
        // in them, and the frame that said so is gone.
        onResync: () => void refresh(),
        onDefaults: (cwd) => setDefaultCwd(serverId, cwd),
      },
      { tasksOnly }
    );
  }, [socket, serverId, upsert, refresh, tasksOnly, setDefaultCwd]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!socket) return noSubscription();
      const off = socket.onStateChange(onChange);
      return () => {
        off();
      };
    },
    [socket]
  );
  const socketState = useSyncExternalStore<GatewaySocketState | null>(
    subscribe,
    () => socket?.state ?? null
  );

  return {
    tasks,
    loading,
    error,
    refresh,
    live: isTaskChannelLive({ wsEvents, demo, socketState }),
  };
}

/**
 * Cancel an open task or confirm a paused one done: the row shows the outcome
 * at once and goes back if the gateway refuses (the caller says why).
 */
export function useTaskAction(
  serverId: string | null
): (task: TaskView, action: 'cancel' | 'complete') => Promise<void> {
  const { t } = useLingui();
  const upsert = useServerTasksStore((state) => state.upsert);
  const replace = useServerTasksStore((state) => state.replace);
  return useCallback(
    async (task: TaskView, action: 'cancel' | 'complete') => {
      if (!serverId) return;
      // A computer this device cannot reach directly (a tunnel no longer
      // selected) is not asked through the shared client, which is another one.
      const route = taskRouteFor(serverId);
      if (!route) throw new Error(t`Computer unavailable.`);
      const endpoint = route.kind === 'endpoint' ? route.endpoint : undefined;
      // At the task's own time: a newer frame from the gateway still wins, and
      // putting the old view back on failure replaces only this guess. Settled
      // now, so an old task does not leave Home before the gateway answers.
      upsert(serverId, {
        ...task,
        state: action === 'cancel' ? 'cancelled' : 'done',
        settledAtMs: Date.now(),
      });
      const call = action === 'cancel' ? cancelTask : completeTask;
      return call(task.taskId, endpoint).then(
        (answer) => {
          if (answer) {
            upsert(serverId, answer);
            return;
          }
          // The gateway no longer knows the task: read the list again.
          // If that read fails too, the guess is taken back.
          const requestedAtMs = Date.now();
          void fetchTaskList({ limit: 100, ...(endpoint ? { endpoint } : {}) }).then((list) => {
            if (list) replace(serverId, list, requestedAtMs);
            else upsert(serverId, task);
          });
        },
        (failure: unknown) => {
          upsert(serverId, task);
          throw failure;
        }
      );
    },
    [serverId, upsert, replace, t]
  );
}
