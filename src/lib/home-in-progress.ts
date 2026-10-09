/**
 * Which ledger tasks Home lists, and in what order.
 *
 * Pure, so the selection rules are pinned by Bun tests; `home-attention.tsx`
 * (Needs you) and the Continue rows are the views. The computer cards'
 * "Now" block is `home-computer-cards.ts`.
 */

import type { ServerTasksIndex } from './server-tasks-state';
import { isTerminalTaskState, type TaskState, type TaskView } from './task-ledger';

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

/**
 * Tasks waiting on the reader, newest first: they belong with Needs you.
 *
 * The gateway moves a delegation to `waiting` exactly when its bound session
 * raises a permission or form request, and Needs you lists that request
 * already, as a row that opens the session where it can be answered. A task
 * bound to such a session is that same request again, so it is left out.
 */
export function homeWaitingTasks(
  index: ServerTasksIndex,
  serverIds: readonly string[],
  pending: readonly PendingSessionTarget[] = []
): HomeTaskRow[] {
  const listed = new Set(pending.map((target) => `${target.serverId}\n${target.asid}`));
  const rows: HomeTaskRow[] = [];
  for (const row of rowsWhere(index, serverIds, (task) => task.state === 'waiting')) {
    const { binding } = row.task;
    if (binding.kind === 'agent_session' && listed.has(`${row.serverId}\n${binding.asid}`)) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The ledger's state for the task an agent session is running, when one is
 * open: a Continue row reads its status from here rather than from a session
 * status that lags it. The newest such task wins.
 */
export function boundTaskState(
  tasks: readonly TaskView[] | undefined,
  asid: string | undefined
): TaskState | undefined {
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
  return found?.state;
}

/** The meta-line colour an open task's state wears, in the Continue row's tones. */
export function taskStateTone(state: TaskState): 'info' | 'warning' | 'textSubtle' {
  if (state === 'working' || state === 'dispatching') return 'info';
  if (state === 'waiting') return 'warning';
  return 'textSubtle';
}
