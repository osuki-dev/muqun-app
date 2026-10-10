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

/** How many finished tasks the sheet keeps; the ledger itself keeps more. */
export const FINISHED_TASKS_SHOWN = 50;

function newestFirst(tasks: readonly TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => b.updatedMs - a.updatedMs);
}

/**
 * One task as the gateway now has it, replacing any older view of it.
 *
 * Frames can arrive out of order: the gateway re-publishes a parent with
 * fresh `children` after a child changes, and that frame may land after a
 * newer one for the parent. The view with the larger `updatedMs` is kept; on
 * a tie the later frame wins.
 */
export function upsertTask(
  index: ServerTasksIndex,
  serverId: string,
  task: TaskView
): ServerTasksIndex {
  const entry = index[serverId];
  const known = entry?.tasks.find((candidate) => candidate.taskId === task.taskId);
  if (known && known.updatedMs > task.updatedMs) return index;
  const others = (entry?.tasks ?? []).filter((known) => known.taskId !== task.taskId);
  return {
    ...index,
    [serverId]: { tasks: newestFirst([...others, task]), fetchedAt: entry?.fetchedAt ?? null },
  };
}

/**
 * A whole list answer, read from a request sent at `requestedAtMs` (this
 * device's clock) and landing at `nowMs`.
 *
 * Frames keep arriving while the read is in flight, so the answer is merged,
 * not swapped in: a task the store holds in a newer view (`updatedMs`, the
 * gateway's clock) keeps it, and a task the list does not name is kept only if
 * it reached this device after the request left -- a frame or the dock's own
 * POST answer the read could not have seen. Anything else the list leaves out
 * is gone from the ledger.
 */
export function replaceTasks(
  index: ServerTasksIndex,
  serverId: string,
  tasks: readonly TaskView[],
  nowMs: number,
  requestedAtMs: number = nowMs
): ServerTasksIndex {
  const held = new Map((index[serverId]?.tasks ?? []).map((task) => [task.taskId, task]));
  const listed = tasks.map((task) => {
    const known = held.get(task.taskId);
    return known && known.updatedMs > task.updatedMs ? known : task;
  });
  const named = new Set(tasks.map((task) => task.taskId));
  const arrived = [...held.values()].filter(
    (task) => !named.has(task.taskId) && (task.receivedAtMs ?? -Infinity) >= requestedAtMs
  );
  return {
    ...index,
    [serverId]: { tasks: newestFirst([...listed, ...arrived]), fetchedAt: nowMs },
  };
}

/**
 * The agent sessions whose task the ledger held as `waiting` and now holds
 * in another state: their question notices are stale. Read from the stored
 * ledger before and after an update, so a frame the store ignored as older
 * moves nothing, and a task not yet seen waiting (its question push came
 * first) keeps its notice.
 */
export function sessionsLeftWaiting(
  before: readonly TaskView[],
  after: readonly TaskView[]
): string[] {
  const waiting = new Set(
    before.filter((task) => task.state === 'waiting').map((task) => task.taskId)
  );
  const asids: string[] = [];
  for (const task of after) {
    if (
      task.state !== 'waiting' &&
      waiting.has(task.taskId) &&
      task.binding.kind === 'agent_session'
    ) {
      asids.push(task.binding.asid);
    }
  }
  return asids;
}

/** Tasks that have not finished, waiting ones included. */
export function activeTaskCount(tasks: readonly TaskView[]): number {
  let count = 0;
  for (const task of tasks) if (!isTerminalTaskState(task.state)) count += 1;
  return count;
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
  /**
   * Where each computer runs a task this device opens without a folder, as
   * its gateway last said (`~` for home). Absent while it has not said, or
   * cannot (a gateway before Task 20).
   */
  defaultCwd: Record<string, string>;
  /** `null`: the gateway says it cannot name it now. */
  setDefaultCwd: (serverId: string, cwd: string | null) => void;
  /** Forgets every computer not in `serverIds` (unpaired). */
  keepOnly: (serverIds: readonly string[]) => void;
  /** A list answer to a request sent at `requestedAtMs` (see `replaceTasks`). */
  replace: (serverId: string, tasks: readonly TaskView[], requestedAtMs: number) => void;
  upsert: (serverId: string, task: TaskView) => void;
};

/** `record` without the keys `keep` refuses; the same object when nothing goes. */
export function keepKeys<T>(
  record: Record<string, T>,
  keep: (key: string) => boolean
): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every(keep)) return record;
  return Object.fromEntries(keys.filter(keep).map((key) => [key, record[key]!]));
}

export function createServerTasksState(
  now: () => number = Date.now
): StateCreator<ServerTasksState> {
  return (set) => ({
    index: {},
    defaultCwd: {},
    setDefaultCwd: (serverId, cwd) =>
      set((state) => {
        if ((state.defaultCwd[serverId] ?? null) === cwd) return state;
        const { [serverId]: _previous, ...others } = state.defaultCwd;
        return { defaultCwd: cwd ? { ...others, [serverId]: cwd } : others };
      }),
    keepOnly: (serverIds) =>
      set((state) => {
        const kept = new Set(serverIds);
        const index = keepKeys(state.index, (serverId) => kept.has(serverId));
        const defaultCwd = keepKeys(state.defaultCwd, (serverId) => kept.has(serverId));
        return index === state.index && defaultCwd === state.defaultCwd
          ? state
          : { index, defaultCwd };
      }),
    replace: (serverId, tasks, requestedAtMs) =>
      set((state) => ({
        index: replaceTasks(state.index, serverId, tasks, now(), requestedAtMs),
      })),
    upsert: (serverId, task) =>
      set((state) => ({
        index: upsertTask(state.index, serverId, { ...task, receivedAtMs: now() }),
      })),
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
