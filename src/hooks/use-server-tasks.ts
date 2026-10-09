import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { isDemoActive } from '@/lib/demo-gateway';
import { configuredGatewayServerId } from '@/lib/gateway-client';
import { WS_EVENTS_CAPABILITY, type GatewaySocketState } from '@/lib/gateway-socket';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import {
  applyCancelAnswer,
  applyListAnswer,
  groupTasks,
  isTaskChannelLive,
  type TaskGroups,
} from '@/lib/server-tasks-state';
import { cancelTask, fetchTaskList, type TaskView } from '@/lib/task-ledger';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerTasksStore } from '@/stores/server-tasks';

const NO_TASKS: TaskView[] = [];
const noSubscription = () => () => {};

export type ServerTasks = {
  tasks: TaskView[];
  groups: TaskGroups;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  /** Whether changes arrive by themselves; false means "updates when you reopen". */
  live: boolean;
};

/**
 * The selected server's task ledger: fetched on mount and whenever the app
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
  const wsEvents = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId]?.includes(WS_EVENTS_CAPABILITY) === true : false
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** A slower answer for an earlier request must not overwrite a newer one. */
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    // The fetchers talk to the shared client's server; asking it about another
    // record would file one server's tasks under another's id.
    if (!serverId || configuredGatewayServerId() !== serverId) {
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const list = await fetchTaskList({ limit: 100 });
      if (request !== requestRef.current) return;
      // A failed read keeps the list already held and says so.
      applyListAnswer(list, {
        replace: (tasks) => replace(serverId, tasks),
        ok: () => setError(null),
        fail: () => setError('unavailable'),
      });
    } catch (failure) {
      if (request !== requestRef.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    if (request === requestRef.current) setLoading(false);
  }, [serverId, replace]);

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
  const socket =
    serverId && wsEvents && !demo && configuredGatewayServerId() === serverId
      ? gatewaySocketFor(serverId)
      : null;

  useEffect(() => {
    if (!socket || !serverId) return;
    return socket.watchTasks({
      onTaskUpdated: (task) => upsert(serverId, task),
      // After every (re)connect: whatever changed while it was down.
      onSubscribed: () => void refresh(),
      // The gateway dropped frames for this socket; a task may have changed
      // in them, and the frame that said so is gone.
      onResync: () => void refresh(),
    });
  }, [socket, serverId, upsert, refresh]);

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

  const cancel = useCallback(
    async (taskId: string) => {
      if (!serverId) return;
      await applyCancelAnswer(taskId, {
        cancel: cancelTask,
        upsert: (task) => upsert(serverId, task),
        refresh,
      });
    },
    [serverId, upsert, refresh]
  );

  return {
    tasks,
    groups: groupTasks(tasks),
    loading,
    error,
    refresh,
    cancel,
    live: isTaskChannelLive({ wsEvents, demo, socketState }),
  };
}
