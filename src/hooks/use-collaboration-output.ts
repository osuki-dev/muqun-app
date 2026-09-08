import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { loadAgents, readPaneOutput } from '@/lib/gateway-client';
import {
  canAssignToAgent,
  compactCollaborationOutput,
  readCollaborationOutput,
  type CollaborationTask,
} from '@/lib/agent-collaboration';
import { describeGatewayFailure } from '@/lib/network-error';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** Shared by the terminal notice and history sheet; never replaces a reader's snapshot. */
export function useCollaborationOutput(task: CollaborationTask | undefined, enabled: boolean) {
  const { t } = useLingui();
  const [output, setOutput] = useState('');
  const [outputTaskId, setOutputTaskId] = useState<string | null>(null);
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [hasNewOutput, setHasNewOutput] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!task || !enabled) return;
    const observedTask = task;
    let cancelled = false;
    let running = false;
    let initialized = false;
    let displayed = '';
    let timer: ReturnType<typeof setTimeout>;
    setOutput('');
    setOutputTaskId(task.id);
    setOutputError(null);
    setOutputLoading(true);
    setHasNewOutput(false);
    const assertConnection = () => {
      if (useGatewayConnectionStore.getState().record?.serverId !== task.serverId)
        throw new Error(t`Return to this server to continue.`);
    };
    async function poll() {
      if (cancelled || running || AppState.currentState !== 'active') return;
      running = true;
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
            assertConnection();
            const text =
              !initialized && canAssignToAgent(agent.status ?? 'unknown')
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
          assertConnection
        );
        if (cancelled || AppState.currentState !== 'active') return;
        if (!snapshot) throw new Error(t`Agent no longer present`);
        if (!initialized) {
          displayed = snapshot.signature;
          initialized = true;
          setOutput(compactCollaborationOutput(snapshot.text));
        }
        setHasNewOutput(snapshot.signature !== displayed);
        setOutputError(null);
      } catch (failure) {
        if (!cancelled)
          setOutputError(describeGatewayFailure(failure, t`Could not read the terminal.`).message);
      } finally {
        running = false;
        if (!cancelled) {
          setOutputLoading(false);
          timer = setTimeout(() => void poll(), 6000);
        }
      }
    }
    void poll();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') void poll();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [task, enabled, refresh, t]);
  return {
    output: task?.id === outputTaskId ? output : '',
    outputLoading,
    outputError: task?.id === outputTaskId ? outputError : null,
    hasNewOutput: task?.id === outputTaskId && hasNewOutput,
    refreshOutput: () => setRefresh((value) => value + 1),
  };
}
