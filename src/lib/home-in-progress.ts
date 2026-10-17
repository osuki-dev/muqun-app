/**
 * Which ledger tasks Home lists, and in what order.
 *
 * Pure, so the selection rules are pinned by Bun tests; `home-attention.tsx`
 * (Needs you) and the Continue rows are the views. The computer cards'
 * "Now" block is `home-computer-cards.ts`.
 */

import type { ServerTasksIndex } from './server-tasks-state';
import { taskHasPendingInput, type TaskAttentionInput } from './task-attention';
import type { ServerAgentsIndex } from './server-agents';
import { isRemoteCommandTask, isTerminalTaskState, type TaskView } from './task-ledger';

export type HomeTaskRow = { serverId: string; task: TaskView };

function rowsWhere(
  index: ServerTasksIndex,
  serverIds: readonly string[],
  keep: (task: TaskView) => boolean
): HomeTaskRow[] {
  const rows: HomeTaskRow[] = [];
  for (const serverId of new Set(serverIds)) {
    for (const task of index[serverId]?.tasks ?? []) {
      if (keep(task)) rows.push({ serverId, task });
    }
  }
  return rows.sort((a, b) => b.task.updatedMs - a.task.updatedMs);
}

/** An agent session Needs you already lists for its own pending request. */
export type PendingSessionTarget = { serverId: string; asid: string };

/** Confirmed requests only; recorded waiting status is not an input request. */
export function homeWaitingTasks(
  index: ServerTasksIndex,
  serverIds: readonly string[],
  pending: readonly PendingSessionTarget[] = [],
  attention: {
    panesByServer?: ServerAgentsIndex;
    requests?: TaskAttentionInput['requests'];
    nowMs: number;
  } = { nowMs: Date.now() }
): HomeTaskRow[] {
  const listed = new Set(pending.map((target) => `${target.serverId}\n${target.asid}`));
  const rows: HomeTaskRow[] = [];
  for (const row of rowsWhere(index, serverIds, (task) => !isRemoteCommandTask(task))) {
    if (
      !taskHasPendingInput({
        task: row.task,
        serverId: row.serverId,
        panes: attention.panesByServer?.[row.serverId],
        requests: attention.requests,
        nowMs: attention.nowMs,
      })
    )
      continue;
    const { binding } = row.task;
    if (binding.kind === 'agent_session' && listed.has(`${row.serverId}\n${binding.asid}`)) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The waiting tasks the top Needs you section lists (design §3a item 4): only
 * when they span two or more computers. With one, that computer's card
 * already lists them first, in the needs-you tone, and a second copy above
 * it says nothing new.
 */
export function needsYouAcrossComputers(rows: readonly HomeTaskRow[]): HomeTaskRow[] {
  const computers = new Set(rows.map((row) => row.serverId));
  return computers.size >= 2 ? [...rows] : [];
}

/**
 * The open ledger task an agent session is running, if any: a Continue row
 * reads its status (word and tone, from the one state table) from it rather
 * than from a session status that lags it. The newest such task wins.
 */
export function boundTask(
  tasks: readonly TaskView[] | undefined,
  asid: string | undefined
): TaskView | undefined {
  if (!asid || !tasks) return undefined;
  let found: TaskView | undefined;
  for (const task of tasks) {
    if (
      task.binding.kind === 'agent_session' &&
      task.binding.asid === asid &&
      !isTerminalTaskState(task.state) &&
      (!found || task.updatedMs > found.updatedMs)
    ) {
      found = task;
    }
  }
  return found;
}
