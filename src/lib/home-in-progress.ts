/**
 * Which ledger tasks Home lists, and in what order.
 *
 * Pure, so the selection rules are pinned by Bun tests; `home-in-progress.tsx`
 * (In progress) and `home-attention.tsx` (Needs you) are the views.
 */

import type { ServerTasksIndex } from './server-tasks-state';
import { isTerminalTaskState, type TaskState, type TaskView } from './task-ledger';

/** The rows In progress shows before it hands the rest to the Tasks sheet. */
export const HOME_IN_PROGRESS_LIMIT = 5;

/**
 * Running or about to run. `waiting` asks for the reader and goes to Needs you;
 * `idle_unconfirmed` is not claimed as progress -- an idle agent is not proof
 * of anything -- and stays in the Tasks sheet.
 */
const IN_PROGRESS: ReadonlySet<TaskState> = new Set<TaskState>([
  'working',
  'dispatching',
  'queued',
]);

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

/** In progress on the given computers, newest change first, capped; `total` counts them all. */
export function homeInProgressTasks(
  index: ServerTasksIndex,
  serverIds: readonly string[],
  limit = HOME_IN_PROGRESS_LIMIT
): { rows: HomeTaskRow[]; total: number } {
  const all = rowsWhere(index, serverIds, (task) => IN_PROGRESS.has(task.state));
  return { rows: all.slice(0, Math.max(0, limit)), total: all.length };
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
