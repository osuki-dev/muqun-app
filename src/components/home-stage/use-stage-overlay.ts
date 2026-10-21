import type { FormRequest, PermissionRequest } from '@/lib/agent-protocol';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { homeWaitingTasks } from '@/lib/home-in-progress';
import { homeThreadKey } from '@/lib/home-thread';
import {
  stageNeeds,
  stageProgress,
  type StageNeeds,
  type StageProgress,
} from '@/lib/stage-overlay';
import type { TaskView } from '@/lib/task-ledger';
import { useHomeAttention } from '@/stores/home-attention';
import { useHomeThreadLive, useHomeThreads } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';

const NO_PERMISSIONS: readonly PermissionRequest[] = [];
const NO_FORMS: readonly FormRequest[] = [];
const NO_TASKS: readonly TaskView[] = [];

/**
 * What waits on the reader on `serverId`, from the sources Needs you reads
 * (the attention observations, the ledger's waiting tasks, the pane mirror)
 * plus the dock's live conversation, whose requests it carries in full.
 * Subscribes to this computer's slices only.
 */
export function useStageNeeds(serverId: string): StageNeeds & {
  /** The dock's conversation answers questions in the terminal: none from the card. */
  terminal: boolean;
} {
  const thread = useHomeThreads((state) => state.byServer[serverId]);
  const session = thread?.kind === 'session' ? thread : undefined;
  const key = session ? homeThreadKey(session) : null;
  const permissions = useHomeThreadLive((state) =>
    key !== null && state.key === key ? state.live.permissions : NO_PERMISSIONS
  );
  const forms = useHomeThreadLive((state) =>
    key !== null && state.key === key ? state.live.forms : NO_FORMS
  );
  const terminal = useHomeThreadLive(
    (state) => key !== null && state.key === key && state.live.interaction === 'terminal'
  );
  const observations = useHomeAttention((state) => state.byTarget);
  const tasks = useServerTasksStore((state) => state.index[serverId]);
  const panes = useServerAgents((state) => state.byServer[serverId]);
  const nowMs = useMinuteNow();
  const pending = Object.values(observations)
    .filter((snapshot) => snapshot.requestIds.length > 0)
    .map((snapshot) => snapshot.target);
  const waitingTasks = tasks
    ? homeWaitingTasks({ [serverId]: tasks }, [serverId], pending, {
        ...(panes ? { panesByServer: { [serverId]: panes } } : {}),
        requests: observations,
        nowMs,
      }).map((row) => row.task)
    : NO_TASKS;
  const needs = stageNeeds({
    serverId,
    ...(session
      ? {
          thread: {
            target: {
              kind: 'agent-session',
              serverId,
              sessionId: session.sessionId,
              directory: session.directory ?? '',
              asid: session.asid,
              ...(session.agentId ? { agentId: session.agentId } : {}),
            },
            permissions,
            forms,
          },
        }
      : {}),
    observations,
    waitingTasks,
    ...(panes ? { panes } : {}),
    nowMs,
  });
  return { ...needs, terminal };
}

/**
 * The newest progress an agent working on `serverId` reported: its ledger
 * task's progress line, or what the dock's pane conversation last read off
 * the agent's screen while it worked (no read of its own).
 */
export function useStageProgress(serverId: string): StageProgress | null {
  const tasks = useServerTasksStore((state) => state.index[serverId]?.tasks ?? NO_TASKS);
  const panes = useServerAgents((state) => state.byServer[serverId]);
  const thread = useHomeThreads((state) => state.byServer[serverId]);
  const pane = thread?.kind === 'pane' ? thread : undefined;
  const key = pane ? homeThreadKey(pane) : null;
  const paneLine = useHomeThreadLive((state) =>
    key !== null && state.key === key ? state.live.paneLine : undefined
  );
  const nowMs = useMinuteNow();
  return stageProgress({
    tasks,
    ...(panes ? { panes } : {}),
    ...(pane && paneLine
      ? {
          paneLine: {
            paneId: pane.paneId,
            ...(pane.agentLabel ? { agentLabel: pane.agentLabel } : {}),
            text: paneLine.text,
            atMs: paneLine.atMs,
          },
        }
      : {}),
    nowMs,
  });
}
