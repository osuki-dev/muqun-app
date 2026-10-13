import type { HomeAttentionSnapshot } from './home-attention';
import type { ServerAgentsSnapshot } from './server-agents';
import type { TaskView } from './task-ledger';
import { terminalPendingUserInput } from './terminal-input-attention';

/** A recorded blocker is not itself a question or permission request. */
export function taskAttentionDestination(input: {
  task: TaskView;
  serverId: string;
  panes?: ServerAgentsSnapshot;
  requests: Readonly<Record<string, HomeAttentionSnapshot>>;
  nowMs: number;
}): 'work' | 'waiting-detail' {
  const { task, serverId, panes, requests, nowMs } = input;
  if (task.state !== 'waiting') return 'work';
  const binding = task.binding;
  if (
    binding.kind === 'pane' &&
    binding.agentId &&
    panes?.serverId === serverId &&
    terminalPendingUserInput(panes, binding.sessionId, binding.paneId, nowMs, binding.shellPid)
  )
    return 'work';
  if (
    binding.kind === 'agent_session' &&
    Object.values(requests).some(
      (snapshot) =>
        snapshot.target.serverId === serverId &&
        snapshot.target.asid === binding.asid &&
        snapshot.requestIds.length > 0
    )
  )
    return 'work';
  return 'waiting-detail';
}
