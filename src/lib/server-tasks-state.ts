import type { StateCreator } from 'zustand/vanilla';

import type { GatewaySocketState } from './gateway-socket';
import { isTerminalTaskState, type TaskView } from './task-ledger';

/**
 * What each paired server's task ledger last said, in memory only.
 *
 * Kept free of React Native so the rules below run under `bun test`: the hook
 * and the sheet decide when to ask, this file decides what the answer means.
 */
export type ServerTasksEntry = { tasks: TaskView[]; fetchedAt: number | null };
export type ServerTasksIndex = Record<string, ServerTasksEntry>;

export type TaskGroups = { attention: TaskView[]; active: TaskView[]; finished: TaskView[] };

/** How many finished tasks the sheet keeps; the ledger itself keeps more. */
export const FINISHED_TASKS_SHOWN = 50;

function newestFirst(tasks: readonly TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => b.updatedMs - a.updatedMs);
}

/** One task as the gateway now has it, replacing any older view of it. */
export function upsertTask(
  index: ServerTasksIndex,
  serverId: string,
  task: TaskView
): ServerTasksIndex {
  const entry = index[serverId];
  const others = (entry?.tasks ?? []).filter((known) => known.taskId !== task.taskId);
  return {
    ...index,
    [serverId]: { tasks: newestFirst([...others, task]), fetchedAt: entry?.fetchedAt ?? null },
  };
}

/** A whole list answer, which is the truth as of `nowMs`. */
export function replaceTasks(
  index: ServerTasksIndex,
  serverId: string,
  tasks: readonly TaskView[],
  nowMs: number
): ServerTasksIndex {
  return { ...index, [serverId]: { tasks: newestFirst(tasks), fetchedAt: nowMs } };
}

/**
 * Waiting is the one state that asks for the reader; everything else that has
 * not finished is in progress, `idle_unconfirmed` included -- an idle agent is
 * not a finished task.
 */
export function groupTasks(tasks: readonly TaskView[]): TaskGroups {
  const sorted = newestFirst(tasks);
  const attention: TaskView[] = [];
  const active: TaskView[] = [];
  const finished: TaskView[] = [];
  for (const task of sorted) {
    if (task.state === 'waiting') attention.push(task);
    else if (isTerminalTaskState(task.state)) {
      if (finished.length < FINISHED_TASKS_SHOWN) finished.push(task);
    } else active.push(task);
  }
  return { attention, active, finished };
}

/** Tasks that have not finished, waiting ones included. */
export function activeTaskCount(tasks: readonly TaskView[]): number {
  let count = 0;
  for (const task of tasks) if (!isTerminalTaskState(task.state)) count += 1;
  return count;
}

/**
 * Cancel, then show whatever the gateway answered -- which may be `done` for a
 * task that finished first, and that is shown as done rather than as an error.
 * A gateway that no longer knows the task (404) makes the list ask again.
 */
export async function applyCancelAnswer(
  taskId: string,
  deps: {
    cancel: (taskId: string) => Promise<TaskView | null>;
    upsert: (task: TaskView) => void;
    refresh: () => Promise<void>;
  }
): Promise<void> {
  const answer = await deps.cancel(taskId);
  if (answer) deps.upsert(answer);
  else await deps.refresh();
}

/**
 * A list answer lands only when the read succeeded (`list` non-null). A failed
 * read leaves what the store already holds and reports the failure instead.
 */
export function applyListAnswer(
  list: readonly TaskView[] | null,
  deps: { replace: (tasks: readonly TaskView[]) => void; fail: () => void; ok: () => void }
): void {
  if (list === null) {
    deps.fail();
    return;
  }
  deps.replace(list);
  deps.ok();
}

/**
 * Whether task changes arrive by themselves. Without `ws_events`, in the demo,
 * or while the socket is not open, the sheet says it updates on reopen.
 */
export function isTaskChannelLive(input: {
  wsEvents: boolean;
  demo: boolean;
  socketState: GatewaySocketState | null;
}): boolean {
  return input.wsEvents && !input.demo && input.socketState === 'open';
}

export type ServerTasksState = {
  index: ServerTasksIndex;
  replace: (serverId: string, tasks: readonly TaskView[]) => void;
  upsert: (serverId: string, task: TaskView) => void;
};

export function createServerTasksState(
  now: () => number = Date.now
): StateCreator<ServerTasksState> {
  return (set) => ({
    index: {},
    replace: (serverId, tasks) =>
      set((state) => ({ index: replaceTasks(state.index, serverId, tasks, now()) })),
    upsert: (serverId, task) =>
      set((state) => ({ index: upsertTask(state.index, serverId, task) })),
  });
}

/** How long ago a task last changed, as a bucket the sheet can say in any locale. */
export function taskAgeParts(
  updatedMs: number,
  nowMs: number
): { unit: 'now' | 'minute' | 'hour' | 'day'; value: number } {
  const seconds = Math.max(0, Math.round((nowMs - updatedMs) / 1000));
  if (seconds < 60) return { unit: 'now', value: 0 };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

/** The last lines of a task's summary: the tail is where a command says how it ended. */
export function summaryTail(summary: string, lines = 12): string {
  const all = summary.replace(/\s+$/, '').split('\n');
  return all.length > lines ? all.slice(all.length - lines).join('\n') : all.join('\n');
}
