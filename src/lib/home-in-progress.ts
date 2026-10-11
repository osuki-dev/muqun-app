/**
 * Which ledger tasks Home lists, and in what order.
 *
 * Pure, so the selection rules are pinned by Bun tests; `home-attention.tsx`
 * (Needs you) and the Continue rows are the views. The computer cards'
 * "Now" block is `home-computer-cards.ts`.
 */

import type { ServerTasksIndex } from './server-tasks-state';
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
  pending: readonly PendingSessionTarget[] = [],
  peerServerOf: (binding: { peerId: string; peerServerId?: string }) => string = (binding) =>
    binding.peerServerId ?? binding.peerId
): HomeTaskRow[] {
  const listed = new Set(pending.map((target) => `${target.serverId}\n${target.asid}`));
  const fresh = new Set(serverIds);
  const rows: HomeTaskRow[] = [];
  for (const row of rowsWhere(
    index,
    serverIds,
    (task) => task.state === 'waiting' && !isRemoteCommandTask(task)
  )) {
    const { binding } = row.task;
    if (binding.kind === 'agent_session' && listed.has(`${row.serverId}\n${binding.asid}`)) {
      continue;
    }
    // A question is listed once: a mirror of work on another computer whose
    // real task this phone also holds fresh, and waiting, is that task's
    // question again. The mirror stays when that computer's own ledger is not
    // here, or the real task there has not reached `waiting` (or has left it).
    // With the mirror hidden, only the running computer has the question, so
    // the top section (two or more computers) stays closed and its card lists it.
    if (binding.kind === 'peer' && binding.remoteTaskId) {
      const there = peerServerOf(binding);
      const held =
        fresh.has(there) &&
        index[there]?.tasks.some(
          (task) =>
            task.taskId === binding.remoteTaskId &&
            task.state === 'waiting' &&
            !isRemoteCommandTask(task)
        ) === true;
      if (held) continue;
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
