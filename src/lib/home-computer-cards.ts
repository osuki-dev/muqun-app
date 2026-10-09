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

/** Running, about to, or asking the reader. */
const ACTIVE: ReadonlySet<TaskState> = new Set<TaskState>([
  'queued',
  'dispatching',
  'working',
  'waiting',
]);

/**
 * The states a card's "Now" lists: the active ones and `idle_unconfirmed` --
 * an agent that stopped without saying it finished is paused, not done; the
 * work may go on, and it is never shown as a result.
 */
const NOW: ReadonlySet<TaskState> = new Set<TaskState>([...ACTIVE, 'idle_unconfirmed']);

export type CardTaskRow = {
  task: TaskView;
  /** Direct children the ledger holds that are still open, newest first. */
  children: TaskView[];
};

/** A goal the dock sent that the computer has not reported back yet. */
export type PendingDispatch = { id: string; serverId: string; goal: string; atMs: number };

export type CardActivity = 'needs-you' | 'working' | 'paused' | 'idle' | 'offline';

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

/** Whether a root row, or work under it, is running or asking (not only paused). */
function treeRowIsActive(row: CardTaskRow): boolean {
  if (ACTIVE.has(row.task.state)) return true;
  if (row.children.some((child) => ACTIVE.has(child.state))) return true;
  const counts = row.task.children;
  return Boolean(counts && counts.active + counts.waiting > 0);
}

/** Open rows with work running first, paused ones after; newest first within each. */
function activeBeforePaused(rows: readonly CardTaskRow[]): CardTaskRow[] {
  return [...rows].sort(
    (a, b) => Number(treeRowIsActive(b)) - Number(treeRowIsActive(a)) || newest(a.task, b.task)
  );
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
  for (const row of activeBeforePaused(rows)) {
    if (treeRowIsWaiting(row)) attention.push(row.task);
    else if (treeRowIsOpen(row) || !isTerminalTaskState(row.task.state)) active.push(row.task);
    else if (finished.length < FINISHED_TASKS_SHOWN) finished.push(row.task);
  }
  return { attention, active, finished };
}

/**
 * How far the computer's clock may run behind the phone's: `updatedMs` is the
 * gateway's time, `atMs` the device's.
 */
export const PENDING_CLOCK_SKEW_MS = 60_000;

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
      task.updatedMs >= item.atMs - PENDING_CLOCK_SKEW_MS &&
      (task.origin === undefined || task.origin === 'device')
  );
}

/** How long a finished task, not yet acknowledged, keeps its computer's card on Home. */
export const RECENT_FINISHED_MS = 30 * 60_000;

const ACTIVITY_RANK: Record<CardActivity, number> = {
  'needs-you': 0,
  working: 1,
  paused: 2,
  idle: 3,
  offline: 4,
};

/**
 * The cards of the computers that have work, sorted needs-you → working →
 * paused → idle (the reader's own order within each).
 *
 * A computer gets a card only while it has something to show: an open task,
 * a goal just sent, or a finished task not yet acknowledged from the last
 * {@link RECENT_FINISHED_MS}. One that is offline, idle with nothing recent,
 * or keeps no ledger gets none; Settings and the dock's target picker list
 * every computer. The room each card gets follows how many are shown.
 */
export function buildComputerCards(input: {
  servers: readonly { serverId: string }[];
  index: ServerTasksIndex;
  reachability: (serverId: string) => ServerReachability | undefined;
  dismissed: ReadonlySet<string>;
  pending?: readonly PendingDispatch[];
  /** The phone's clock, for what counts as recently finished. */
  nowMs: number;
  limits?: CardLimits;
}): ComputerCard[] {
  const all = input.servers.map((server, order): ComputerCard & { order: number } => {
    const entry = input.index[server.serverId];
    const tasks = entry?.tasks ?? [];
    const tree = buildTaskTree(tasks);
    // A root stays in Now while any work it started is still open, even after
    // the root itself finished: a delegating turn can end before its
    // sub-tasks do, and an idle parent is not finished work.
    const open = activeBeforePaused(tree.filter(treeRowIsOpen));
    const finishedAll = tree
      .filter((row) => !treeRowIsOpen(row) && isTerminalTaskState(row.task.state))
      .map((row) => row.task);
    const finished = finishedAll.filter(
      (task) =>
        !input.dismissed.has(dismissedKey(server.serverId, task.taskId)) &&
        input.nowMs - task.updatedMs <= RECENT_FINISHED_MS
    );
    const pending = (input.pending ?? []).filter(
      (item) => item.serverId === server.serverId && !settlesPending(tasks, item)
    );
    // The same predicates Now uses, so work known only from the gateway's
    // child counts moves the card as well as listing it.
    const waiting = tasks.some((task) => task.state === 'waiting') || tree.some(treeRowIsWaiting);
    const working = tree.some(treeRowIsActive) || pending.length > 0;
    const activity: CardActivity =
      input.reachability(server.serverId) === 'offline'
        ? 'offline'
        : waiting
          ? 'needs-you'
          : working
            ? 'working'
            : open.length > 0
              ? 'paused'
              : 'idle';
    return {
      order,
      serverId: server.serverId,
      activity,
      pending,
      now: open.map((row) => ({
        task: row.task,
        children: row.children.filter((child) => !isTerminalTaskState(child.state)),
      })),
      nowTotal: open.length,
      finished,
    };
  });
  const shown = all.filter(
    (card) =>
      card.activity !== 'offline' &&
      (card.now.length > 0 || card.pending.length > 0 || card.finished.length > 0)
  );
  const limits = input.limits ?? cardLimits(shown.length);
  return shown
    .sort((a, b) => ACTIVITY_RANK[a.activity] - ACTIVITY_RANK[b.activity] || a.order - b.order)
    .map(({ order: _order, ...card }) => ({
      ...card,
      now: card.now.slice(0, Math.max(0, limits.now)),
      finished: card.finished.slice(0, Math.max(0, limits.finished)),
    }));
}

/**
 * What a task row opens: the thing the task runs in. A session-bound task
 * opens its agent session, a pane-bound one its pane -- unless it failed,
 * when the pane may be gone and the row's result line already says why.
 * Null when there is nothing to open (not bound yet, or failed in a pane).
 */
export function taskRowDestination(
  task: TaskView
):
  | { kind: 'session'; asid: string; agentId: string }
  | { kind: 'pane'; paneId: string; sessionId: string }
  | null {
  const binding = task.binding;
  if (binding.kind === 'agent_session') {
    return { kind: 'session', asid: binding.asid, agentId: binding.agentId };
  }
  if (binding.kind === 'pane' && task.state !== 'failed') {
    return { kind: 'pane', paneId: binding.paneId, sessionId: binding.sessionId };
  }
  return null;
}

/**
 * The newest terminal-agent task bound to a pane: a Continue row for that
 * pane can say the task's goal instead of the launch command.
 */
export function paneLedgerTask(
  tasks: readonly TaskView[] | undefined,
  paneId: string | undefined
): TaskView | undefined {
  if (!tasks || !paneId) return undefined;
  let found: TaskView | undefined;
  for (const task of tasks) {
    if (
      task.binding.kind === 'pane' &&
      task.binding.agentId &&
      task.binding.paneId === paneId &&
      (!found || task.updatedMs > found.updatedMs)
    ) {
      found = task;
    }
  }
  return found;
}

/** The two ways into a computer's work, as Home's commands open them. */
export type TaskOpeners = {
  openAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => unknown;
  openServer: (serverId: string, paneId?: string, sessionId?: string) => unknown;
};

/** Open what a task runs in; false when it has nothing to open. */
export function openTaskWork(commands: TaskOpeners, serverId: string, task: TaskView): boolean {
  const destination = taskRowDestination(task);
  if (!destination) return false;
  if (destination.kind === 'session') {
    void commands.openAgent(serverId, destination.asid, undefined, undefined, destination.agentId);
  } else {
    void commands.openServer(serverId, destination.paneId, destination.sessionId);
  }
  return true;
}

/**
 * The second line of a task row: what the computer saw and is doing, one
 * state at a time -- starting the agent, its live progress, the question it
 * asks, the hint where it paused, the result it left, or why it failed.
 */
export type TaskRowLine =
  | { kind: 'state' }
  | { kind: 'starting' }
  | { kind: 'progress'; text: string }
  | { kind: 'elapsed' }
  | { kind: 'waiting'; text?: string }
  | { kind: 'paused'; text?: string }
  | { kind: 'result'; text: string }
  | { kind: 'exit'; code: number }
  | { kind: 'error'; text: string };

export function taskRowLine(task: TaskView): TaskRowLine {
  const result = taskResultLine(task);
  const said = result?.kind === 'summary' ? result.text : undefined;
  switch (task.state) {
    case 'queued':
      return { kind: 'state' };
    case 'dispatching':
      return { kind: 'starting' };
    case 'working':
      return task.progress ? { kind: 'progress', text: task.progress } : { kind: 'elapsed' };
    case 'waiting':
      return said ? { kind: 'waiting', text: said } : { kind: 'waiting' };
    case 'idle_unconfirmed':
      return said ? { kind: 'paused', text: said } : { kind: 'paused' };
    case 'failed':
      if (said) return { kind: 'error', text: said };
      return result?.kind === 'exit' ? { kind: 'exit', code: result.code } : { kind: 'state' };
    case 'done':
    case 'cancelled':
      if (said) return { kind: 'result', text: said };
      return result?.kind === 'exit' ? { kind: 'exit', code: result.code } : { kind: 'state' };
  }
}
