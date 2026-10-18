import type { HomeAttentionSnapshot } from './home-attention';
import { isServerAgentsStale, type ServerAgentsSnapshot } from './server-agents';
import { isTerminalTaskState, type TaskView } from './task-ledger';
import { terminalPendingUserInput } from './terminal-input-attention';

export type TaskAttentionInput = {
  task: TaskView;
  serverId: string;
  panes?: ServerAgentsSnapshot;
  requests?: Readonly<Record<string, HomeAttentionSnapshot>>;
  nowMs: number;
};

/** Only an identity-bound native question or a concrete session request needs input. */
export function taskHasPendingInput({
  task,
  serverId,
  panes,
  requests = {},
  nowMs,
}: TaskAttentionInput): boolean {
  if (isTerminalTaskState(task.state)) return false;
  const binding = task.binding;
  if (binding.kind === 'pane') {
    return Boolean(
      binding.agentId &&
      panes?.serverId === serverId &&
      terminalPendingUserInput(panes, binding.sessionId, binding.paneId, nowMs, binding.shellPid)
    );
  }
  return (
    binding.kind === 'agent_session' &&
    Object.values(requests).some(
      (snapshot) =>
        snapshot.target.serverId === serverId &&
        snapshot.target.asid === binding.asid &&
        snapshot.requestIds.length > 0
    )
  );
}

/** A read-only view: recorded blockers never become confirmation requests. */
export function taskAttentionView(input: TaskAttentionInput): TaskView {
  const { task, serverId, panes, nowMs } = input;
  if (taskHasPendingInput(input)) {
    return { ...task, state: 'waiting', summary: undefined };
  }
  if (task.state !== 'waiting') return task;
  const binding = task.binding;
  const working =
    binding.kind === 'pane' &&
    binding.agentId &&
    binding.shellPid &&
    panes?.serverId === serverId &&
    panes.sessionId === binding.sessionId &&
    !isServerAgentsStale(panes, nowMs) &&
    panes.agents.some(
      (agent) =>
        agent.paneId === binding.paneId &&
        agent.shellPid === binding.shellPid &&
        Boolean(agent.instanceId) &&
        agent.hasAgent &&
        agent.status === 'working' &&
        agent.pendingUserInput === false
    );
  // Unknown/offline observations do not resolve the ledger: its original state
  // and summary remain available in history. Home shows a quiet paused row.
  return {
    ...task,
    state: working ? 'working' : 'idle_unconfirmed',
    summary: undefined,
    progress: undefined,
  };
}
