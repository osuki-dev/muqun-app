/**
 * Home's computer cards: one per paired computer, saying what it is doing
 * now, what it just finished, and whether it needs the reader.
 *
 * Pure, so the rules are pinned by Bun tests; `home-computer-cards.tsx` is the
 * view. The ledger is the source: a card reads the tasks its computer's
 * socket and list reads left in `useServerTasksStore`, never an agent's
 * status (an idle agent is not a finished task).
 */

import type { HomeSessionParams } from '@/lib/home-composer';
import { taskAttentionView, type TaskAttentionInput } from './task-attention';
import type { ServerReachability } from './server-reachability';
import {
  isServerAgentsStale,
  MAX_SERVER_AGENTS,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from './server-agents';
import { stripTaskMarkers, taskMarkerPayload } from './task-plumbing';
import { FINISHED_TASKS_SHOWN, type ServerTasksIndex } from './server-tasks-state';
import {
  isRemoteCommandTask,
  isTerminalTaskState,
  type TaskState,
  type TaskView,
} from './task-ledger';

/**
 * A computer card's inner side padding. Home's phone dock pads its content by
 * the same amount, so the dock's lines start where the cards' rows do.
 */
export const HOME_CARD_INSET = 12;

/**
 * Which computers' ledgers to keep live: every one that keeps a ledger and can
 * be reached directly, the selected one first, then the others in the reader's
 * own order. A tunnelled record has no address that means anything from here
 * unless it is the selected one, whose tunnel the workspace holds; its card
 * says it is not being followed rather than freezing on old rows. A computer
 * that does not answer costs only its socket's own reconnect backoff.
 */
export function taskSubscriptionServerIds(input: {
  servers: readonly { serverId: string; sshTunnel?: unknown }[];
  selectedId?: string;
  hasLedger: (serverId: string) => boolean;
  isDemo?: (serverId: string) => boolean;
  /**
   * Home's own check says it is down. Not followed (no socket retrying
   * against it while Home is up) until it answers again, which puts it back.
   * The selected computer is always followed: its workspace holds it.
   */
  isOffline?: (serverId: string) => boolean;
}): string[] {
  const { servers, selectedId, hasLedger, isDemo = () => false, isOffline = () => false } = input;
  const ordered = [
    ...servers.filter((server) => server.serverId === selectedId),
    ...servers.filter((server) => server.serverId !== selectedId),
  ];
  const ids: string[] = [];
  for (const server of ordered) {
    if (ids.includes(server.serverId) || isDemo(server.serverId)) continue;
    if (!hasLedger(server.serverId)) continue;
    if (server.serverId !== selectedId && (server.sshTunnel || isOffline(server.serverId)))
      continue;
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

/**
 * Exactly what a failed send carried, so a retry sends that and nothing else:
 * the text, the files already uploaded, and the agent, mode, model and folder
 * it was going to -- whatever the dock holds by then. In memory only.
 */
export type PendingResend = {
  text: string;
  attachments: string[];
  params: HomeSessionParams;
  folder?: string;
};

/** A sent goal no task ever answered stops claiming the computer is busy after this. */
export const PENDING_DISPATCH_TTL_MS = 2 * 60_000;

/**
 * Whether a Sent row is still shown: always, until something settles it.
 * A plain one the gateway never answered used to go after
 * PENDING_DISPATCH_TTL_MS, which read as the work vanishing; it stays as
 * "delivery not confirmed" until the gateway's task appears
 * (`settlesPending`) or the reader dismisses it. A failed one holds a draft
 * and stays until it is sent again or dismissed; one that went to its
 * session stays until that session's task appears or it is dismissed.
 */
export function pendingShown(_item: PendingDispatch, _nowMs: number): boolean {
  return true;
}

/** A plain Sent row the gateway has not answered within the TTL: delivery unconfirmed. */
export function pendingUnconfirmed(item: PendingDispatch, nowMs: number): boolean {
  return (
    item.failed !== true && item.asid === undefined && nowMs - item.atMs >= PENDING_DISPATCH_TTL_MS
  );
}

/**
 * Whether a Sent row is work the computer is doing: its session is working
 * on it, or it was sent recently and nothing said otherwise.
 */
export function pendingWorking(item: PendingDispatch, nowMs: number): boolean {
  if (item.failed === true) return false;
  if (item.reply) return item.reply.state === 'working';
  return nowMs - item.atMs < PENDING_DISPATCH_TTL_MS;
}

/** What a bound row's session says: no reply yet, or the reply's run state. */
export type BoundSessionState = 'waiting' | 'working' | 'done' | 'failed';

/**
 * A bound row's session, read: `waiting` until the agent's first reply after
 * the prompt (a session Home made carries nothing before it), then the run
 * state the session reports.
 */
export function boundSessionState(snapshot: {
  info: { status: string } | null;
  timeline: readonly { role: string }[];
}): BoundSessionState {
  if (!snapshot.timeline.some((item) => item.role === 'assistant')) return 'waiting';
  switch (snapshot.info?.status) {
    case 'busy':
    case 'retry':
      return 'working';
    case 'failed':
    case 'interrupted':
      return 'failed';
    default:
      return 'done';
  }
}

/** A goal the dock sent that the computer has not reported back yet. */
export type PendingDispatch = {
  id: string;
  serverId: string;
  goal: string;
  atMs: number;
  /**
   * The send failed: the row says so, with `reason`, until a retry replaces it
   * or it expires, and it is not work the computer is doing.
   */
  failed?: true;
  reason?: string;
  /** What a tap on the failed row sends again. */
  resend?: PendingResend;
  /**
   * The session it went to, where it went to one directly (a goal with
   * files): the row stands for that session until its task appears.
   */
  asid?: string;
  /** What that session said once the agent replied, and when it was read. */
  reply?: { state: Exclude<BoundSessionState, 'waiting'>; atMs: number };
};

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

/** Show five current tasks per computer; one computer gets an extra finished row. */
export function cardLimits(computers: number): CardLimits {
  return { now: 5, finished: computers === 1 ? 3 : 2 };
}

/** Acknowledged tasks are remembered by computer and task id. */
/**
 * The key an acknowledgement is kept under: one finish of one task, not the
 * task. A task the gateway reopened (`reopenCount`) finishes again under a
 * new key, so its new finish shows until acknowledged in turn.
 */
export function dismissedKey(
  serverId: string,
  task: { taskId: string; reopenCount?: number }
): string {
  return `${serverId}\n${task.taskId}\n${task.reopenCount ?? 0}`;
}

/** A Home-only removal belongs to the assignment, including later activity. */
export function hiddenTaskKey(serverId: string, taskId: string): string {
  return `${serverId}\n${taskId}`;
}

function hiddenTask(
  task: TaskView,
  serverId: string,
  hidden: ReadonlySet<string> | undefined,
  byId: ReadonlyMap<string, TaskView>
): boolean {
  if (!hidden?.size) return false;
  let current: TaskView | undefined = task;
  const seen = new Set<string>();
  while (current && !seen.has(current.taskId)) {
    if (hidden.has(hiddenTaskKey(serverId, current.taskId))) return true;
    seen.add(current.taskId);
    const parentId: string | undefined = current.parentTaskId;
    if (parentId && hidden.has(hiddenTaskKey(serverId, parentId))) return true;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return false;
}

/**
 * The acknowledgements still held, given what the ledgers say now: one whose
 * task is back at work is let go, so the task's next finish shows -- the rule
 * for a gateway that does not count reopens, where the state change is the
 * only sign. A task not in view keeps its acknowledgements. Returns the same
 * array when nothing is let go.
 */
export function acknowledgementsHeld(
  dismissed: readonly string[],
  index: Readonly<Record<string, { tasks?: readonly TaskView[] } | undefined>>
): readonly string[] {
  const working = new Set<string>();
  for (const [serverId, entry] of Object.entries(index)) {
    for (const task of entry?.tasks ?? []) {
      if (!isTerminalTaskState(task.state)) working.add(`${serverId}\n${task.taskId}\n`);
    }
  }
  if (working.size === 0) return dismissed;
  const held = dismissed.filter((key) => !working.has(key.slice(0, key.lastIndexOf('\n') + 1)));
  return held.length === dismissed.length ? dismissed : held;
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
  // An older gateway leaves the agent's marker in the text it records: the
  // words after it are the summary; without any, the text around it.
  const marked = task.summary ? taskMarkerPayload(task.summary) : null;
  if (marked) return { kind: 'summary', text: marked };
  const summary = task.summary && stripTaskMarkers(task.summary).trim();
  if (summary) {
    const lines = summary.split('\n').filter((line) => line.trim());
    const last = lines[lines.length - 1]?.trim();
    if (last) return { kind: 'summary', text: last };
  }
  if (task.exitCode !== undefined) return { kind: 'exit', code: task.exitCode };
  return null;
}

/** How long a title derived from the goal may run, as the gateway clips it. */
const TITLE_CHARS = 60;

/** A word-boundary cut that would leave less than this cuts hard at {@link TITLE_CHARS} instead. */
const MIN_WORD_CUT_CHARS = 30;

/** Whitespace collapsed to single spaces; past `max` characters, cut with `…`. */
function oneLine(text: string, max: number): string {
  const line = text.split(/\s+/).filter(Boolean).join(' ');
  const chars = [...line];
  if (chars.length <= max) return line;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * The goal's first sentence -- up to the first `.` or `?`/`!` followed by a
 * space, a `。`/`？`/`！`, or a line end -- cut at a word to
 * {@link TITLE_CHARS}: the gateway's own derivation (`pane_agent::title`),
 * for a gateway that does not send `title`.
 */
export function goalTitle(goal: string): string {
  const text = goal.trim();
  let end = text.length;
  for (let at = 0; at < text.length; at += 1) {
    const c = text[at];
    const spaced = at + 1 >= text.length || /\s/.test(text[at + 1]!);
    if (c === '\n' || c === '。' || (c === '.' && spaced)) {
      end = at;
      break;
    }
    if (c === '？' || c === '！' || ((c === '?' || c === '!') && spaced)) {
      end = at + 1;
      break;
    }
  }
  const sentence = oneLine(text.slice(0, end), Infinity);
  const line = oneLine(sentence, TITLE_CHARS);
  if (!line.endsWith('…')) return line;
  // Cut mid-word unless a space came next: back to the last whole word, when
  // that still leaves a title -- a long path as the second word would leave
  // "In…" -- else the hard cut stands.
  const cut = line.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  const words = cut.slice(0, Math.max(0, space));
  return sentence.slice(cut.length).startsWith(' ') || [...words].length < MIN_WORD_CUT_CHARS
    ? line
    : `${words}…`;
}

/**
 * The one line that names a task on Home and in Recent: the requester's
 * label, else the gateway's title (the agent session's own name once it has
 * one), else the goal's first sentence, clipped. Never the goal paragraph.
 */
export function taskRowTitle(task: TaskView): string {
  return task.label || task.title || goalTitle(task.goal);
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

/** How urgent a root row is: its most urgent open work, by {@link taskRowRank}. */
function treeRowRank(row: CardTaskRow): number {
  if (treeRowIsWaiting(row)) return 0;
  const open = [row.task, ...row.children].filter((task) => NOW.has(task.state));
  const counted = (row.task.children?.active ?? 0) > 0 ? 1 : 3;
  return Math.min(counted, ...open.map((task) => taskRowRank(task.state)));
}

/** Rows by urgency (waiting, working, starting, paused), newest first within each. */
function byUrgency(rows: readonly CardTaskRow[]): CardTaskRow[] {
  return [...rows].sort((a, b) => treeRowRank(a) - treeRowRank(b) || newest(a.task, b.task));
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
export function groupTaskTree(
  rows: readonly CardTaskRow[],
  needsInput?: (task: TaskView) => boolean
): {
  attention: TaskView[];
  active: TaskView[];
  finished: TaskView[];
} {
  const attention: TaskView[] = [];
  const active: TaskView[] = [];
  const finished: TaskView[] = [];
  for (const row of byUrgency(rows)) {
    const waiting = needsInput
      ? [row.task, ...row.children].some(needsInput)
      : treeRowIsWaiting(row);
    if (waiting) attention.push(row.task);
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
      (item.asid !== undefined &&
        task.binding.kind === 'agent_session' &&
        task.binding.asid === item.asid) ||
      (task.goal.trim() === goal &&
        task.updatedMs >= item.atMs - PENDING_CLOCK_SKEW_MS &&
        (task.origin === undefined || task.origin === 'device'))
  );
}

/** How many finished rows a card shows before "Show more"; the rest wait behind it. */
export const FINISHED_ROWS_SHOWN = 3;

/**
 * Repeated cancelled attempts at one goal say one thing: only the newest of
 * them is kept (`tasks` is newest first). Applied before acknowledgements, so
 * acknowledging that row takes the whole group with it. A task with no title
 * is nobody's repeat.
 */
function collapseCancelled(tasks: readonly TaskView[]): TaskView[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (task.state !== 'cancelled') return true;
    const title = taskRowTitle(task);
    if (!title) return true;
    if (seen.has(title)) return false;
    seen.add(title);
    return true;
  });
}

const ACTIVITY_RANK: Record<CardActivity, number> = {
  'needs-you': 0,
  working: 1,
  paused: 2,
  idle: 3,
  offline: 4,
};

/** Home omits a gone terminal; its task and saved result remain in the ledger. */
function hasClosedTaskPane(
  task: TaskView,
  serverId: string,
  snapshot: ServerAgentsSnapshot | undefined,
  nowMs: number
): boolean {
  const binding = task.binding;
  if (binding.kind !== 'pane') return false;
  // These are Gateway follower failure reasons, optionally followed by the
  // last screen line. Do not interpret arbitrary output mentioning a closure.
  if (
    task.state === 'failed' &&
    (task.summary === 'pane closed' ||
      task.summary === 'the pane closed' ||
      task.summary?.startsWith('the pane closed: '))
  )
    return true;
  // Only a newer, complete observation of this exact session proves absence.
  // An old, capped, legacy or differently scoped mirror is not such proof.
  if (
    !snapshot ||
    snapshot.serverId !== serverId ||
    snapshot.sessionId !== binding.sessionId ||
    isServerAgentsStale(snapshot, nowMs) ||
    snapshot.checkedAtMs < (task.receivedAtMs ?? task.updatedMs) ||
    snapshot.agents.length >= MAX_SERVER_AGENTS ||
    snapshot.agents.some((pane) => !pane.paneId)
  )
    return false;
  return !snapshot.agents.some((pane) => pane.paneId === binding.paneId);
}

/**
 * The cards of the computers that have work, sorted needs-you → working →
 * paused → idle (the reader's own order within each).
 *
 * A computer gets a card only while it has something to show: an open task,
 * a goal sent, or a finished task the reader has not yet dismissed -- time
 * alone never takes a row off a card. One that is offline, idle with nothing
 * to show, or keeps no ledger gets none; Settings and the dock's target
 * picker list every computer. The room each card gets follows how many are
 * shown.
 */
export function buildComputerCards(input: {
  servers: readonly { serverId: string }[];
  index: ServerTasksIndex;
  reachability: (serverId: string) => ServerReachability | undefined;
  dismissed: ReadonlySet<string>;
  /** Assignments removed locally from Home; the ledger remains untouched. */
  hidden?: ReadonlySet<string>;
  pending?: readonly PendingDispatch[];
  /** The phone's clock, for what counts as recently finished. */
  nowMs: number;
  limits?: CardLimits;
  /**
   * The computers whose ledgers are followed; absent, all of them. Any other
   * card sorts as idle: its rows are old news, not something needing the reader.
   */
  followed?: ReadonlySet<string>;
  /** Confirmed pane inventories; absence without one never hides a task. */
  panesByServer?: ServerAgentsIndex;
  requests?: TaskAttentionInput['requests'];
}): ComputerCard[] {
  const all = input.servers.map((server, order): ComputerCard & { order: number } => {
    const entry = input.index[server.serverId];
    // The receiving computer's temporary exec is already represented by its
    // originating conversation. Keep the ledger; omit this duplicate Home row.
    const ledgerTasks = entry?.tasks ?? [];
    const byId = new Map(ledgerTasks.map((task) => [task.taskId, task]));
    // A task whose terminal pane is gone is not dropped: the ledger keeps its
    // summary and result, and the card shows it as finished work. Only the
    // reader's own hidden and dismissed sets omit a row.
    const tasks = ledgerTasks
      .filter(
        (task) =>
          !isRemoteCommandTask(task) && !hiddenTask(task, server.serverId, input.hidden, byId)
      )
      .map((task) =>
        !isTerminalTaskState(task.state) &&
        hasClosedTaskPane(
          task,
          server.serverId,
          input.panesByServer?.[server.serverId],
          input.nowMs
        )
          ? { ...task, state: 'done' as const, settledAtMs: task.settledAtMs ?? input.nowMs }
          : task
      );
    // The rows are rebuilt from the tasks as shown, so a closed pane's task
    // keeps the finished state given above rather than the ledger's.
    const shownById = new Map(tasks.map((task) => [task.taskId, task]));
    const displayTasks = tasks.map((task) =>
      taskAttentionView({
        task,
        serverId: server.serverId,
        panes: input.panesByServer?.[server.serverId],
        requests: input.requests,
        nowMs: input.nowMs,
      })
    );
    const tree = buildTaskTree(displayTasks);
    // A root stays in Now while any work it started is still open, even after
    // the root itself finished: a delegating turn can end before its
    // sub-tasks do, and an idle parent is not finished work.
    const open = byUrgency(tree.filter(treeRowIsOpen));
    const finished = collapseCancelled(
      tree
        .filter((row) => !treeRowIsOpen(row) && isTerminalTaskState(row.task.state))
        .map((row) => row.task)
      // Finished work stays until the reader dismisses it; time alone never
      // takes a row off the card. The card shows a few and the rest wait
      // behind "Show more".
    ).filter((task) => !input.dismissed.has(dismissedKey(server.serverId, task)));
    const pending = (input.pending ?? []).filter(
      (item) => item.serverId === server.serverId && !settlesPending(ledgerTasks, item)
    );
    // The same predicates Now uses, so work known only from the gateway's
    // child counts moves the card as well as listing it.
    const waiting = displayTasks.some((task) => task.state === 'waiting');
    const working =
      displayTasks.some((task) => ACTIVE.has(task.state) || (task.children?.active ?? 0) > 0) ||
      pending.some((item) => pendingWorking(item, input.nowMs));
    const activity: CardActivity =
      input.reachability(server.serverId) === 'offline'
        ? 'offline'
        : input.followed && !input.followed.has(server.serverId)
          ? 'idle'
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
        task: shownById.get(row.task.taskId) ?? row.task,
        children: row.children
          .filter((child) => !isTerminalTaskState(child.state))
          .map((child) => shownById.get(child.taskId) ?? child),
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
 * Finished commands open their saved result on the originating computer:
 * their temporary pane may be closed or its id reused. Other tasks open
 * their session, pane, or the computer that runs a mirror.
 */
export function taskRowDestination(
  task: TaskView
):
  | { kind: 'session'; asid: string; agentId: string }
  | { kind: 'pane'; paneId: string; sessionId: string }
  | { kind: 'peer'; serverId: string; remoteTaskId: string }
  | { kind: 'result' }
  | { kind: 'computer' } {
  if (task.kind === 'command' && isTerminalTaskState(task.state)) return { kind: 'result' };
  const binding = task.binding;
  if (binding.kind === 'agent_session') {
    return { kind: 'session', asid: binding.asid, agentId: binding.agentId };
  }
  if (binding.kind === 'pane') {
    return { kind: 'pane', paneId: binding.paneId, sessionId: binding.sessionId };
  }
  if (binding.kind === 'peer') {
    return {
      kind: 'peer',
      serverId: binding.peerServerId ?? binding.peerId,
      remoteTaskId: binding.remoteTaskId,
    };
  }
  return { kind: 'computer' };
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

/**
 * The newest ledger task, open or finished, run in agent session `asid`: a
 * Recent row for that session is named by it, as the card names it.
 */
export function sessionLedgerTask(
  tasks: readonly TaskView[] | undefined,
  asid: string | undefined
): TaskView | undefined {
  if (!tasks || !asid) return undefined;
  let found: TaskView | undefined;
  for (const task of tasks) {
    if (
      task.binding.kind === 'agent_session' &&
      task.binding.asid === asid &&
      (!found || task.updatedMs > found.updatedMs)
    ) {
      found = task;
    }
  }
  return found;
}

/** The destinations for a task's work or saved result. */
export type TaskOpeners = {
  /** Read a finished command's saved output without opening its old binding. */
  openTaskResult: (serverId: string, task: TaskView) => unknown;
  openAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => unknown;
  openServer: (serverId: string, paneId?: string, sessionId?: string) => unknown;
  /** A task on `serverId` as this phone can see it; null when that computer is not paired here. */
  resolveTask?: (serverId: string, taskId: string) => Promise<TaskView | null>;
  /** The server id of the computer a mirror runs on, as this phone knows it. */
  peerServerId?: (binding: { peerId: string; peerServerId?: string }) => string;
};

/**
 * Read a finished command's saved result, otherwise open what it runs in.
 * A live mirror opens on the computer that runs it. If its task cannot be read (not
 * known yet, or that computer is quiet) opens that computer, which says
 * itself whether it can be reached; a tap never does nothing. Settles when
 * the open has (the row shows a loading state until then); never rejects.
 */
export async function openTaskWork(
  commands: TaskOpeners,
  serverId: string,
  task: TaskView
): Promise<void> {
  const destination = taskRowDestination(task);
  const settled = (open: unknown) =>
    Promise.resolve(open).then(
      () => undefined,
      () => undefined
    );
  if (destination.kind === 'result') {
    return settled(commands.openTaskResult(serverId, task));
  }
  if (destination.kind === 'peer') {
    const resolve = commands.resolveTask;
    if (!resolve || task.binding.kind !== 'peer') return;
    const there = commands.peerServerId?.(task.binding) ?? destination.serverId;
    if (!destination.remoteTaskId) return settled(commands.openServer(there));
    const remote = await resolve(there, destination.remoteTaskId).catch(() => null);
    if (!remote) return settled(commands.openServer(there));
    if (remote.binding.kind !== 'peer') return openTaskWork(commands, there, remote);
    return;
  }
  if (destination.kind === 'session') {
    return settled(
      commands.openAgent(serverId, destination.asid, undefined, undefined, destination.agentId)
    );
  }
  if (destination.kind === 'pane') {
    return settled(commands.openServer(serverId, destination.paneId, destination.sessionId));
  }
  return settled(commands.openServer(serverId));
}

/** A row's state: the ledger's, or `sent` for a goal the computer has not reported yet. */
export type TaskRowState = TaskState | 'sent';

/**
 * The second line of a task row: what the computer saw and is doing, one
 * state at a time -- sent, starting the agent, its live progress, the
 * question it asks, the hint where it paused, the result it left, or why it
 * failed.
 */
export type TaskRowLine =
  | { kind: 'sent' }
  | { kind: 'starting' }
  | { kind: 'progress'; text: string }
  | { kind: 'agent' }
  | { kind: 'waiting'; text?: string }
  | { kind: 'paused'; text?: string }
  | { kind: 'result'; text: string }
  | { kind: 'exit'; code: number }
  | { kind: 'error'; text: string }
  | { kind: 'state' }
  /** An open mirror whose computer has gone quiet (§10.12). */
  | { kind: 'unreachable'; lastSeenMs?: number }
  /** A failed mirror, worded from the gateway's `reason` code, never its text. */
  | { kind: 'mirrorFailed'; reason: string };

export type TaskRowTone = 'textMuted' | 'primary' | 'warning' | 'success' | 'danger';
export type TaskRowAction = 'open' | 'cancel' | 'markDone' | 'acknowledge';

/**
 * Everything a row shows for its state: one tone, one line, its actions. No
 * glyph: the state word on the second line is the only state marker
 * (home-dispatch-ux §11).
 */
export type TaskRowVisual = {
  tone: TaskRowTone;
  /**
   * Only working moves: a small spinner right after the state word, while the
   * reader allows motion.
   */
  spins: boolean;
  line: TaskRowLine;
  /** The right-hand time: how long open work has run, or how long ago it ended. */
  clock: 'elapsed' | 'ago' | 'none';
  /**
   * The row needs the reader: it pulses once on arrival and is marked by its
   * state word only, never a persistent bar (home-dispatch-ux §10).
   */
  needsYou?: true;
  actions: TaskRowAction[];
};

/**
 * The one state → visual table (home-dispatch-ux.md §3), used by Home's
 * cards, the Tasks list and Needs you alike. `canComplete`: the gateway takes
 * Mark done for this task (`canMarkTaskDone`); `acknowledged`: the reader
 * already took it off Home.
 */
export function taskRowVisual(
  task: TaskView | { state: 'sent' },
  opts: { canComplete: boolean; acknowledged: boolean; statusCurrent?: boolean }
): TaskRowVisual {
  const reportedVisual = taskStateVisual(task, opts);
  const visual =
    opts.statusCurrent === false
      ? { ...reportedVisual, spins: false, needsYou: undefined }
      : reportedVisual;
  if (task.state === 'sent' || task.binding.kind !== 'peer') return visual;
  // A failed mirror says why in the app's words: from its reason, or, for a
  // create the other computer refused (no reason, and no task over there to
  // have written the summary), the general line -- the summary is then the
  // gateway's own English sentence, not agent output.
  if (task.state === 'failed' && (task.reason || !task.binding.remoteTaskId)) {
    return { ...visual, line: { kind: 'mirrorFailed', reason: task.reason ?? '' } };
  }
  // An open mirror whose computer is quiet says so in place of its line; the
  // state's icon, tone, clock and actions stand.
  if (
    (task.peerReachable !== false && task.reason !== 'peer_unreachable') ||
    isTerminalTaskState(task.state)
  ) {
    return visual;
  }
  const lastSeenMs = task.peerLastSeenMs;
  return {
    ...visual,
    line: { kind: 'unreachable', ...(lastSeenMs !== undefined ? { lastSeenMs } : {}) },
  };
}

function taskStateVisual(
  task: TaskView | { state: 'sent' },
  opts: { canComplete: boolean; acknowledged: boolean }
): TaskRowVisual {
  if (task.state === 'sent') {
    return {
      tone: 'textMuted',
      spins: false,
      line: { kind: 'sent' },
      clock: 'none',
      actions: [],
    };
  }
  const result = taskResultLine(task);
  const progress = task.progress && stripTaskMarkers(task.progress);
  const said = result?.kind === 'summary' ? result.text : undefined;
  const ended: TaskRowLine = said
    ? { kind: 'result', text: said }
    : result?.kind === 'exit'
      ? { kind: 'exit', code: result.code }
      : { kind: 'state' };
  const live: TaskRowAction[] = ['open', 'cancel'];
  const confirmable: TaskRowAction[] = opts.canComplete ? [...live, 'markDone'] : live;
  const finished: TaskRowAction[] = opts.acknowledged ? ['open'] : ['open', 'acknowledge'];
  switch (task.state) {
    case 'queued':
    case 'dispatching':
      return {
        tone: 'textMuted',
        spins: false,
        line: { kind: 'starting' },
        clock: 'elapsed',
        // Only a mirror is confirmable here: one whose create got no answer
        // stays dispatching, and the reader is the one who can settle it.
        actions: confirmable,
      };
    case 'working':
      return {
        tone: 'primary',
        spins: true,
        // A progress line that says nothing (a TUI rule the gateway read off the
        // screen) is no progress: the agent and elapsed time say more.
        line:
          progress && /[\p{L}\p{N}]/u.test(progress)
            ? { kind: 'progress', text: progress }
            : { kind: 'agent' },
        clock: 'elapsed',
        // Only a mirror is confirmable while working (`canMarkTaskDone`).
        actions: confirmable,
      };
    case 'waiting':
      return {
        tone: 'warning',
        spins: false,
        line: said ? { kind: 'waiting', text: said } : { kind: 'waiting' },
        clock: 'elapsed',
        needsYou: true,
        actions: confirmable,
      };
    case 'idle_unconfirmed':
      return {
        tone: 'textMuted',
        spins: false,
        line: said ? { kind: 'paused', text: said } : { kind: 'paused' },
        clock: 'elapsed',
        actions: confirmable,
      };
    case 'done':
      return {
        tone: 'success',
        spins: false,
        line: ended,
        clock: 'ago',
        actions: finished,
      };
    case 'failed':
      return {
        tone: 'danger',
        spins: false,
        line: said ? { kind: 'error', text: said } : ended,
        clock: 'ago',
        actions: finished,
      };
    case 'cancelled':
      return {
        tone: 'textMuted',
        spins: false,
        line: { kind: 'state' },
        clock: 'ago',
        actions: finished,
      };
  }
}

/** Order inside a card: waiting, then working, then starting, then paused (§3). */
export function taskRowRank(state: TaskRowState): number {
  switch (state) {
    case 'waiting':
      return 0;
    case 'working':
      return 1;
    case 'queued':
    case 'dispatching':
    case 'sent':
      return 2;
    default:
      return 3;
  }
}

/**
 * The cards in the order the reader is looking at (`shownIds`), while a
 * re-sort is held: a card keeps its place, a card that went is dropped, and a
 * card that arrived joins at the end, so nothing above it moves. With nothing
 * held `shownIds` is the sorted order itself and the cards come back as given.
 */
export function heldCardOrder<T extends { serverId: string }>(
  shownIds: readonly string[],
  cards: readonly T[]
): T[] {
  const place = new Map(shownIds.map((serverId, position) => [serverId, position]));
  const kept = cards
    .filter((card) => place.has(card.serverId))
    .sort((a, b) => place.get(a.serverId)! - place.get(b.serverId)!);
  return [...kept, ...cards.filter((card) => !place.has(card.serverId))];
}

/**
 * Whether a followed card's rows are its computer's current activity or the
 * last it heard, and so whether the "Last known activity" caption is wanted.
 *
 * - `none`: no caption and no room for one -- the card is not followed, or
 *   has no rows for the caption to describe.
 * - `hidden`: the rows are current (the task socket is open), or about to be
 *   again: a socket connecting, backing off to reconnect, or paused for the
 *   background is the app on its way back, and announcing the rows as stale
 *   for the length of a reconnect -- or in the app switcher's snapshot --
 *   would call every backgrounding a loss. The caption's room is kept so
 *   its arrival moves nothing.
 * - `shown`: the socket is gone with nothing scheduled to bring it back
 *   (idle, refused, unusable, superseded, or never opened), so the rows are
 *   history and say so.
 */
export type LastKnownActivityCaption = 'shown' | 'hidden' | 'none';

export function lastKnownActivityCaption(input: {
  followed: boolean;
  /** The task socket's state (`GatewaySocketState`), or `undefined` before one exists. */
  socket: string | undefined;
  rows: number;
}): LastKnownActivityCaption {
  if (!input.followed || input.rows <= 0) return 'none';
  switch (input.socket) {
    case 'open':
    case 'connecting':
    case 'backoff':
    case 'paused':
      return 'hidden';
    default:
      return 'shown';
  }
}
