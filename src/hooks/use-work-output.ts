import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { consumeWorkOutputRefresh } from '@/lib/work-output-refresh';
import { parseWorkOutputText } from '@/lib/work-output-text';
import { useFocusEffect } from 'expo-router';
import { readCollaborationOutput } from '@/lib/agent-collaboration';
import {
  observeCollaborationOutput,
  createCollaborationRequestGuard,
  type CollaborationOutputSnapshot,
} from '@/lib/collaboration-presentation';
import { normalizeGatewayEntities } from '@/lib/gateway-entities';
import { field } from '@/lib/herdr-entity';
import { sendBoundWorkRequest } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { WorkAttempt } from '@/lib/work-api';
import type { WorkViewMemory } from '@/lib/work-view-memory';

/** Managed tasks reuse collaboration's identity/read and pinned-snapshot rules. */
export function useWorkOutput(
  record: GatewayRecord,
  sessionId: string,
  attempt: WorkAttempt | undefined,
  enabled: boolean,
  memory: WorkViewMemory
) {
  type Display = {
    owner: WorkViewMemory;
    taskId: string;
    attemptId: string;
    instanceId: string;
    snapshot: CollaborationOutputSnapshot;
    snapshotId: string;
  };
  const [display, setDisplay] = useState<Display | null>(null);
  const displayed = useRef<Display | null>(null);
  const [currentOwner, setCurrentOwner] = useState<{
    owner: WorkViewMemory;
    instanceId: string;
    attemptId: string;
  } | null>(null);
  const [refresh, setRefresh] = useState<{
    attemptId: string;
    nonce: number;
    owner: WorkViewMemory;
  } | null>(null);
  const consumed = useRef(new Map<string, number>());
  const ownership = useRef(createCollaborationRequestGuard());
  const [loading, setLoading] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!attempt?.instance_id || !attempt.pane_id || !enabled) {
        setCurrentOwner(null);
        return;
      }
      let canceled = false;
      ownership.current.invalidate();
      let running = false;
      const task = {
        id: attempt.id,
        taskId: attempt.task_id,
        serverId: record.serverId,
        sessionId,
        sourcePaneId: attempt.pane_id,
        paneId: attempt.pane_id,
        agentInstanceId: attempt.instance_id,
        agentName: attempt.agent_kind,
        prompt: '',
        createdAt: attempt.created_at_ms,
      };
      const root = `/api/sessions/${encodeURIComponent(sessionId)}`;
      const read = async (path: string, isCurrent: () => boolean) => {
        const reply = await sendBoundWorkRequest(record, root + path, {
          isCurrent,
          method: 'GET',
        });
        if (reply.status !== 200 || !isCurrent()) throw new Error('Output unavailable');
        return reply.body;
      };
      async function poll() {
        if (running || canceled || AppState.currentState !== 'active') return;
        running = true;
        const valid = ownership.current.capture();
        const isCurrent = () => !canceled && valid() && AppState.currentState === 'active';
        const replace = consumeWorkOutputRefresh(
          consumed.current,
          task.id,
          refresh?.owner === memory ? refresh : null
        );
        setLoading(true);
        try {
          const output = await readCollaborationOutput(
            task,
            async () =>
              normalizeGatewayEntities(await read('/agents', isCurrent), ['agents', 'items']),
            async () => {
              const value = await read(
                `/panes/${encodeURIComponent(task.paneId)}/output?source=visible&format=text&lines=80`,
                isCurrent
              );
              const text = parseWorkOutputText(value);
              return { text, signature: text };
            },
            () => {
              if (!isCurrent()) throw new Error('Output owner changed');
            }
          );
          if (!isCurrent()) return;
          setCurrentOwner(
            output ? { owner: memory, instanceId: task.agentInstanceId, attemptId: task.id } : null
          );
          if (output) {
            const previous =
              memory.output(task.taskId, task.id, task.agentInstanceId) ??
              (displayed.current?.owner === memory &&
              displayed.current.attemptId === task.id &&
              displayed.current.instanceId === task.agentInstanceId
                ? displayed.current.snapshot
                : undefined);
            const snapshot = observeCollaborationOutput(previous, output, replace);
            const retained = memory.rememberOutput(
              task.taskId,
              task.id,
              task.agentInstanceId,
              snapshot
            );
            const next = {
              owner: memory,
              taskId: task.taskId,
              attemptId: task.id,
              instanceId: task.agentInstanceId,
              snapshot,
              snapshotId: retained
                ? memory.outputIdentity(task.taskId, task.id, task.agentInstanceId)!
                : previous?.signature === snapshot.signature &&
                    displayed.current?.snapshot === previous
                  ? displayed.current.snapshotId
                  : `uncached:${task.id}:${Date.now()}`,
            };
            if (!retained) memory.forgetOutput(task.taskId, task.id);
            displayed.current = next;
            setDisplay(next);
          }
        } catch {
          if (isCurrent()) setCurrentOwner(null);
        } finally {
          running = false;
          if (isCurrent()) setLoading(false);
        }
      }
      void poll();
      const timer = setInterval(() => void poll(), 15000);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void poll();
        else {
          ownership.current.invalidate();
          consumeWorkOutputRefresh(
            consumed.current,
            task.id,
            refresh?.owner === memory ? refresh : null
          );
          setCurrentOwner(null);
          setLoading(false);
        }
      });
      return () => {
        consumeWorkOutputRefresh(
          consumed.current,
          task.id,
          refresh?.owner === memory ? refresh : null
        );
        subscription.remove();
        canceled = true;
        ownership.current.invalidate();
        clearInterval(timer);
      };
    }, [record, sessionId, attempt, enabled, refresh, memory])
  );
  async function verifiedPane() {
    if (!enabled || !attempt?.instance_id || !attempt.pane_id || AppState.currentState !== 'active')
      return null;
    const valid = ownership.current.capture();
    const isCurrent = () => valid() && AppState.currentState === 'active';
    try {
      const reply = await sendBoundWorkRequest(
        record,
        `/api/sessions/${encodeURIComponent(sessionId)}/agents`,
        { method: 'GET', isCurrent }
      );
      if (reply.status !== 200 || !isCurrent()) return null;
      const agents = normalizeGatewayEntities(reply.body, ['agents', 'items']);
      return agents.some(
        (agent) =>
          (field(agent, 'pane_id') || agent.id) === attempt.pane_id &&
          field(agent, 'instance_id') === attempt.instance_id
      )
        ? attempt.pane_id
        : null;
    } catch {
      return null;
    }
  }
  const visible =
    display?.owner === memory &&
    display.attemptId === attempt?.id &&
    display.instanceId === attempt?.instance_id
      ? display
      : null;
  return {
    snapshot:
      visible?.snapshot ??
      (attempt?.instance_id
        ? memory.output(attempt.task_id, attempt.id, attempt.instance_id)
        : undefined),
    snapshotId:
      visible?.snapshotId ??
      (attempt?.instance_id
        ? memory.outputIdentity(attempt.task_id, attempt.id, attempt.instance_id)
        : undefined),
    current:
      currentOwner?.owner === memory &&
      currentOwner.attemptId === attempt?.id &&
      currentOwner.instanceId === attempt?.instance_id &&
      enabled,
    loading,
    verifiedPane,
    refresh: () => {
      if (attempt)
        setRefresh((value) => ({
          attemptId: attempt.id,
          nonce: (value?.nonce ?? 0) + 1,
          owner: memory,
        }));
    },
  };
}
