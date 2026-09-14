import { useLingui } from '@lingui/react/macro';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadAgents, readPaneOutput } from '@/lib/gateway-client';
import {
  canAssignToAgent,
  compactCollaborationOutput,
  readCollaborationOutput,
  type CollaborationTask,
} from '@/lib/agent-collaboration';
import {
  observeCollaborationOutput,
  createCollaborationRequestGuard,
  retainCollaborationSnapshots,
  type CollaborationOutputSnapshot,
} from '@/lib/collaboration-presentation';
import { describeGatewayFailure } from '@/lib/network-error';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** Shared by the terminal notice and history sheet; never replaces a reader's snapshot. */
export function useCollaborationOutput(
  task: CollaborationTask | undefined,
  enabled: boolean,
  retainedTaskIds: string[]
) {
  const { t } = useLingui();
  // Memory only: reconnects and switching assignments must not replace a reader's snapshot.
  const snapshots = useRef(new Map<string, CollaborationOutputSnapshot>());
  const pendingRefresh = useRef(new Set<string>());
  const [displayed, setDisplayed] = useState<Record<string, CollaborationOutputSnapshot>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const retained = useRef(new Set<string>());
  useLayoutEffect(() => {
    const ids = new Set(retainedTaskIds);
    retained.current = ids;
    for (const id of snapshots.current.keys()) if (!ids.has(id)) snapshots.current.delete(id);
    for (const id of pendingRefresh.current) if (!ids.has(id)) pendingRefresh.current.delete(id);
    setDisplayed((previous) => retainCollaborationSnapshots(previous, ids));
    setFailure((previous) => (previous && !ids.has(previous.taskId) ? null : previous));
    setLoadingId((previous) => (previous && !ids.has(previous) ? null : previous));
  }, [retainedTaskIds]);
  useEffect(() => {
    if (!task || !enabled) {
      if (task) pendingRefresh.current.delete(task.id);
      return;
    }
    const observedTask = task;
    let cancelled = false;
    let running = false;
    const activityGuard = createCollaborationRequestGuard();
    let timer: ReturnType<typeof setTimeout>;
    const assertConnection = () => {
      if (useGatewayConnectionStore.getState().record?.serverId !== task.serverId)
        throw new Error(t`Return to this server to continue.`);
    };
    async function poll() {
      if (cancelled || running || AppState.currentState !== 'active') return;
      running = true;
      const isActivityCurrent = activityGuard.capture();
      const isCurrent = () =>
        !cancelled &&
        isActivityCurrent() &&
        retained.current.has(observedTask.id) &&
        AppState.currentState === 'active';
      const assertCurrent = () => {
        if (!isCurrent()) throw new Error('Observation is no longer current');
        assertConnection();
      };
      const replace = pendingRefresh.current.delete(observedTask.id);
      const initial = !snapshots.current.has(observedTask.id);
      if (initial || replace) setLoadingId(observedTask.id);
      try {
        const snapshot = await readCollaborationOutput(
          observedTask,
          () => loadAgents(observedTask.sessionId),
          async (agent) => {
            const signature = await readPaneOutput(
              observedTask.sessionId,
              observedTask.paneId,
              'text',
              80,
              'visible'
            );
            assertCurrent();
            const text =
              (initial || replace) && canAssignToAgent(agent.status ?? 'unknown')
                ? await readPaneOutput(
                    observedTask.sessionId,
                    observedTask.paneId,
                    'text',
                    80,
                    'recent-unwrapped'
                  )
                : signature;
            return { text, signature };
          },
          assertCurrent
        );
        if (!isCurrent()) return;
        if (!snapshot) throw new Error(t`Agent no longer present`);
        const pinned = observeCollaborationOutput(
          snapshots.current.get(observedTask.id),
          { text: compactCollaborationOutput(snapshot.text), signature: snapshot.signature },
          replace
        );
        snapshots.current.set(observedTask.id, pinned);
        setDisplayed((previous) => ({ ...previous, [observedTask.id]: pinned }));
        setFailure(null);
      } catch (failure) {
        if (isCurrent())
          setFailure({
            taskId: observedTask.id,
            message: describeGatewayFailure(failure, t`Could not read the terminal.`).message,
          });
      } finally {
        running = false;
        if (!cancelled) {
          setLoadingId(null);
          if (AppState.currentState === 'active') timer = setTimeout(() => void poll(), 6000);
        }
      }
    }
    void poll();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') void poll();
      else {
        activityGuard.invalidate();
        pendingRefresh.current.delete(observedTask.id);
        setLoadingId(null);
      }
    });
    return () => {
      cancelled = true;
      activityGuard.invalidate();
      clearTimeout(timer);
      subscription.remove();
    };
  }, [task, enabled, refresh, t]);
  const snapshot = task ? displayed[task.id] : undefined;
  return {
    output: snapshot?.text ?? '',
    outputLoading: enabled && loadingId === task?.id,
    outputError: failure?.taskId === task?.id ? (failure?.message ?? null) : null,
    hasNewOutput: snapshot?.hasNewOutput ?? false,
    refreshOutput: () => {
      if (!task || !enabled) return;
      pendingRefresh.current.add(task.id);
      setRefresh((value) => value + 1);
    },
  };
}
