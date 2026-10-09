/**
 * Home's computer cards: one per paired computer, saying what it is doing
 * now, what it just finished, and whether it needs the reader.
 *
 * Pure, so the rules are pinned by Bun tests; `home-computer-cards.tsx` is the
 * view. The ledger is the source: a card reads the tasks its computer's
 * socket and list reads left in `useServerTasksStore`, never an agent's
 * status (an idle agent is not a finished task).
 */

import type { ServerReachability } from './server-reachability';
import { FINISHED_TASKS_SHOWN, type ServerTasksIndex } from './server-tasks-state';
import { isTerminalTaskState, type TaskState, type TaskView } from './task-ledger';

/** Computers that get a task socket while Home or the Tasks sheet is up. */
export const MAX_TASK_SUBSCRIPTIONS = 4;

/**
 * Which computers' ledgers to keep live: the selected one first, then the
 * others in the reader's own order, only those that keep a ledger and can be
 * reached directly (a tunnelled record has no address that means anything
 * from here unless it is the selected one, whose tunnel the workspace holds),
 * at most {@link MAX_TASK_SUBSCRIPTIONS}.
 */
export function taskSubscriptionServerIds(input: {
  servers: readonly { serverId: string; sshTunnel?: unknown }[];
  selectedId?: string;
  hasLedger: (serverId: string) => boolean;
  isDemo?: (serverId: string) => boolean;
  max?: number;
}): string[] {
  const { servers, selectedId, hasLedger, isDemo = () => false } = input;
  const max = Math.max(0, input.max ?? MAX_TASK_SUBSCRIPTIONS);
  const ordered = [
    ...servers.filter((server) => server.serverId === selectedId),
    ...servers.filter((server) => server.serverId !== selectedId),
  ];
  const ids: string[] = [];
  for (const server of ordered) {
    if (ids.length >= max) break;
    if (ids.includes(server.serverId) || isDemo(server.serverId)) continue;
    if (!hasLedger(server.serverId)) continue;
    if (server.sshTunnel && server.serverId !== selectedId) continue;
    ids.push(server.serverId);
  }
  return ids;
}

/** The states a card's "Now" lists: running, about to, or asking the reader. */
const NOW: ReadonlySet<TaskState> = new Set<TaskState>([
  'queued',
  'dispatching',
  'working',
  'waiting',
]);

export type CardTaskRow = {
  task: TaskView;
  /** Direct children the ledger holds that are still open, newest first. */
  children: TaskView[];
};

/** A goal the dock sent that the computer has not reported back yet. */
export type PendingDispatch = { id: string; serverId: string; goal: string; atMs: number };

export type CardActivity = 'needs-you' | 'working' | 'idle' | 'offline';

export type ComputerCard = {
  serverId: string;
  activity: CardActivity;
  /** Sent from the dock, not yet a task. */
  pending: PendingDispatch[];
  now: CardTaskRow[];
  /** Every open root task, `now` being the first few. */
  nowTotal: number;
  /** Finished roots not yet acknowledged, newest first. */
  finished: TaskView[];
  /** The newest finished root, acknowledged or not, for the idle line. */
  lastFinished?: TaskView;
  /** Whether this computer's ledger is known at all (a socket or list answered). */
  known: boolean;
};

export type CardLimits = { now: number; finished: number };

/** One computer gets the room; several share it. */
export function cardLimits(computers: number): CardLimits {
  return computers === 1 ? { now: 5, finished: 3 } : { now: 3, finished: 2 };
}

/** Acknowledged tasks are remembered by computer and task id. */
export function dismissedKey(serverId: string, taskId: string): string {
  return `${serverId}\n${taskId}`;
}

function newest(a: TaskView, b: TaskView): number {
  return b.updatedMs - a.updatedMs;
}

/**
 * Root tasks with their descendants nested one level under them.
 *
 * A grandchild sits beside its parent under the same root: one indent is
 * all a phone row has room for. A task whose parent the ledger does not hold
 * (beyond the page read, or on a gateway without the tree) stands as a root
 * of its own, so nothing open is hidden.
 */
export function buildTaskTree(tasks: readonly TaskView[]): CardTaskRow[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const rootOf = (task: TaskView): TaskView => {
    let current = task;
    const seen = new Set<string>([current.taskId]);
    while (current.parentTaskId) {
      const parent = byId.get(current.parentTaskId);
      if (!parent) break;
      // A cycle (which the gateway's own tree query refuses too): every task
      // in it stands as its own root.
      if (seen.has(parent.taskId)) return task;
      seen.add(parent.taskId);
      current = parent;
    }
    return current;
  };
  const childrenOf = new Map<string, TaskView[]>();
  const roots: TaskView[] = [];
  for (const task of tasks) {
    const root = rootOf(task);
    if (root === task) {
      roots.push(task);
      continue;
    }
    const list = childrenOf.get(root.taskId) ?? [];
    list.push(task);
    childrenOf.set(root.taskId, list);
  }
  return roots.sort(newest).map((task) => ({
    task,
    children: (childrenOf.get(task.taskId) ?? []).sort(newest),
  }));
}

/**
 * The roll-up a root row carries: its direct children by the gateway's own
 * count (which covers children beyond the page this device read).
 */
export function taskRollup(task: TaskView): { total: number; waiting: number } | null {
  const children = task.children;
  if (!children || children.total <= 0) return null;
  return { total: children.total, waiting: children.waiting };
}

/**
 * The one line a finished task leaves: what the agent last said or the
 * command's last line (`summary`), else its exit code, else nothing -- the
 * view then says the state word.
 */
export function taskResultLine(
  task: TaskView
): { kind: 'summary'; text: string } | { kind: 'exit'; code: number } | null {
  const summary = task.summary?.trim();
  if (summary) {
    const lines = summary.split('\n').filter((line) => line.trim());
    const last = lines[lines.length - 1]?.trim();
    if (last) return { kind: 'summary', text: last };
  }
  if (task.exitCode !== undefined) return { kind: 'exit', code: task.exitCode };
  return null;
}

/** The title a task row shows: the requester's label, else the goal. */
export function taskTitle(task: TaskView): string {
  return task.label || task.goal.split('\n')[0]?.trim() || task.taskId;
}

/**
 * Whether a root row is still work in progress: the root itself, any
 * descendant the ledger holds, or -- for children beyond the page read -- the
 * gateway's own count of open direct children.
 */
export function treeRowIsOpen(row: CardTaskRow): boolean {
  if (NOW.has(row.task.state)) return true;
  if (row.children.some((child) => NOW.has(child.state))) return true;
  const counts = row.task.children;
  return Boolean(counts && counts.active + counts.waiting > 0);
}

/** Whether a root row, or work under it, is waiting on the reader. */
export function treeRowIsWaiting(row: CardTaskRow): boolean {
  return (
    row.task.state === 'waiting' ||
    row.children.some((child) => child.state === 'waiting') ||
    (row.task.children?.waiting ?? 0) > 0
  );
}

/**
 * The Tasks sheet's groups over roots: Needs you when the root or work under
 * it waits on the reader, In progress while any of it is open, else Finished
 * (capped as the flat list was). Newest first within each.
 */
export function groupTaskTree(rows: readonly CardTaskRow[]): {
  attention: TaskView[];
  active: TaskView[];
  finished: TaskView[];
} {
  const attention: TaskView[] = [];
  const active: TaskView[] = [];
  const finished: TaskView[] = [];
  for (const row of [...rows].sort((a, b) => newest(a.task, b.task))) {
    if (treeRowIsWaiting(row)) attention.push(row.task);
    else if (treeRowIsOpen(row) || !isTerminalTaskState(row.task.state)) active.push(row.task);
    else if (finished.length < FINISHED_TASKS_SHOWN) finished.push(row.task);
  }
  return { attention, active, finished };
}

/**
 * A sent goal is answered by a task with that goal that changed at or after
 * the send -- an older task that happens to share the goal (a retry, a
 * routine "run the tests") does not count. A device-opened task is preferred:
 * one the gateway says came from elsewhere never settles it.
 */
function settlesPending(tasks: readonly TaskView[], item: PendingDispatch): boolean {
  const goal = item.goal.trim();
  return tasks.some(
    (task) =>
      task.goal.trim() === goal &&
      task.updatedMs >= item.atMs &&
      (task.origin === undefined || task.origin === 'device')
  );
}

const ACTIVITY_RANK: Record<CardActivity, number> = {
  'needs-you': 0,
  working: 1,
  idle: 2,
  offline: 3,
};

/**
 * Every computer's card, sorted needs-you → working → idle → offline (the
 * reader's own order within each).
 */
export function buildComputerCards(input: {
  servers: readonly { serverId: string }[];
  index: ServerTasksIndex;
  reachability: (serverId: string) => ServerReachability | undefined;
  dismissed: ReadonlySet<string>;
  pending?: readonly PendingDispatch[];
  limits?: CardLimits;
}): ComputerCard[] {
  const limits = input.limits ?? cardLimits(input.servers.length);
  const cards = input.servers.map((server, order): ComputerCard & { order: number } => {
    const entry = input.index[server.serverId];
    const tasks = entry?.tasks ?? [];
    const tree = buildTaskTree(tasks);
    // A root stays in Now while any work it started is still open, even after
    // the root itself finished: a delegating turn can end before its
    // sub-tasks do, and an idle parent is not finished work.
    const open = tree.filter(treeRowIsOpen);
    const finishedAll = tree
      .filter((row) => !treeRowIsOpen(row) && isTerminalTaskState(row.task.state))
      .map((row) => row.task);
    const finished = finishedAll.filter(
      (task) => !input.dismissed.has(dismissedKey(server.serverId, task.taskId))
    );
    const pending = (input.pending ?? []).filter(
      (item) => item.serverId === server.serverId && !settlesPending(tasks, item)
    );
    const waiting = tasks.some((task) => task.state === 'waiting');
    const working = tasks.some((task) => NOW.has(task.state)) || pending.length > 0;
    const activity: CardActivity =
      input.reachability(server.serverId) === 'offline'
        ? 'offline'
        : waiting
          ? 'needs-you'
          : working
            ? 'working'
            : 'idle';
    return {
      order,
      serverId: server.serverId,
      activity,
      pending,
      now: open.slice(0, Math.max(0, limits.now)).map((row) => ({
        task: row.task,
        children: row.children.filter((child) => !isTerminalTaskState(child.state)),
      })),
      nowTotal: open.length,
      finished: finished.slice(0, Math.max(0, limits.finished)),
      ...(finishedAll[0] ? { lastFinished: finishedAll[0] } : {}),
      known: Boolean(entry),
    };
  });
  return cards
    .sort((a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity] || a.order - b.order)
    .map(({ order: _order, ...card }) => card);
}
