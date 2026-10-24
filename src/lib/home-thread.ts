/**
 * Home's thread: the conversation the dock's next message goes to.
 *
 * The first goal sent from Home starts a conversation, as it always did; every
 * message after it is a follow-up in that same conversation until the reader
 * clears it (× on the chip, "New conversation") or the conversation ends. One
 * target per computer, kept across launches, never on a timer.
 *
 * Pure: what a send does given the target, when a target has ended, and what
 * the live strip reads from a session's snapshot and events. The dock
 * (`home-composer-dock.tsx`) and `components/home-thread.tsx` are the views.
 */

import type {
  AgentDomainEvent,
  AgentRunStatus,
  AgentSessionSnapshot,
  FormRequest,
  PermissionRequest,
} from '@/lib/agent-protocol';
import type { AgentSessionRuntime } from '@/lib/agent-session-runtime';
import type { HomeContinueEntry, GatewayAgentSessionsSnapshot } from '@/lib/home-continue';
import {
  HOME_AGENT_SESSION_ID,
  homeSessionSwitches,
  type HomeSessionParams,
} from '@/lib/home-composer';
import type { AgentStatus } from '@/lib/herdr-entity';
import type { ServerAgentsSnapshot } from '@/lib/server-agents';
import type { TaskView } from '@/lib/task-ledger';
import { sessionActivity } from '@/lib/stage-overlay';

type ThreadBase = {
  serverId: string;
  /** What the card and the drawer call it: the session's or the goal's title. */
  title: string;
  /** The ledger task it runs as, when it is one: its progress line and binding. */
  taskId?: string;
  /**
   * The dock's mode and model when this became the target, or as last
   * switched. A pill changed since is switched on the session before the
   * follow-up (`homeThreadSendPlan`); absent until the dock has read them.
   */
  pills?: HomeSessionParams;
  /** The reader's last message from Home: a pane has no transcript to show it from. */
  lastSent?: string;
  /** This device's clock when `lastSent` was accepted: anything read before it is stale. */
  sentAtMs?: number;
  /** When it became the target; mirrors older than this say nothing about it. */
  setAtMs: number;
};

export type HomeThreadSession = ThreadBase & {
  kind: 'session';
  /** Gateway routing session (`herdr`), not the agent's own session id. */
  sessionId: string;
  asid: string;
  agentId?: string;
  directory?: string;
};

export type HomeThreadPane = ThreadBase & {
  kind: 'pane';
  /** Herdr session the pane is in, when known; otherwise read at send time. */
  sessionId?: string;
  paneId: string;
  /** The agent's own name, as the gateway reported it. */
  agentLabel?: string;
  /** The agent instance it was when targeted: a reused pane is not this conversation. */
  instanceId?: string;
};

/** A ledger task the gateway accepted before saying where it runs. */
export type HomeThreadTask = ThreadBase & { kind: 'task'; taskId: string };

export type HomeThreadTarget = HomeThreadSession | HomeThreadPane | HomeThreadTask;

/** One conversation's identity, for the live strip's store and React keys. */
export function homeThreadKey(target: HomeThreadTarget): string {
  switch (target.kind) {
    case 'session':
      return `${target.serverId}\u0000s\u0000${target.agentId ?? ''}\u0000${target.asid}`;
    case 'pane':
      return `${target.serverId}\u0000p\u0000${target.paneId}`;
    case 'task':
      return `${target.serverId}\u0000t\u0000${target.taskId}`;
  }
}

/**
 * What tapping a Home session card targets: an agent session, or a pane with
 * an agent in it. A plain shell, an SSH host or a pane the gateway did not
 * name is not a conversation, and the card opens as before (`null`).
 */
export function homeThreadTargetFromEntry(
  entry: HomeContinueEntry,
  nowMs: number,
  panesOf?: (serverId: string) => ServerAgentsSnapshot | undefined
): HomeThreadTarget | null {
  const { destination } = entry;
  const base = { title: entry.title, setAtMs: nowMs };
  const session = (target: {
    serverId: string;
    sessionId: string;
    asid: string;
    agentId?: string;
    directory?: string;
  }): HomeThreadSession => ({
    ...base,
    kind: 'session',
    serverId: target.serverId,
    sessionId: target.sessionId,
    asid: target.asid,
    ...(target.agentId ? { agentId: target.agentId } : {}),
    ...(target.directory ? { directory: target.directory } : {}),
  });
  const pane = (serverId: string, paneId: string, sessionId?: string): HomeThreadPane | null => {
    const panes = panesOf?.(serverId);
    const row =
      panes?.serverId === serverId
        ? panes.agents.find((agent) => agent.paneId === paneId)
        : undefined;
    if (row ? !row.hasAgent : !entry.agentLabel) return null;
    const agentLabel = row?.agentLabel ?? entry.agentLabel;
    return {
      ...base,
      kind: 'pane',
      serverId,
      paneId,
      ...(sessionId ? { sessionId } : panes?.sessionId ? { sessionId: panes.sessionId } : {}),
      ...(agentLabel ? { agentLabel } : {}),
      ...(row?.instanceId ? { instanceId: row.instanceId } : {}),
    };
  };
  if (destination.type === 'agent-session') return session(destination.target);
  if (destination.type === 'pane')
    return destination.paneId ? pane(destination.serverId, destination.paneId) : null;
  const target = destination.target;
  if (target.kind === 'agent-session') return session(target);
  if (target.kind === 'gateway-terminal')
    return pane(target.serverId, target.paneId, target.sessionId);
  return null;
}

/** Where a ledger task the dock opened runs, as the target the next message goes to. */
export function homeThreadTargetFromTask(
  serverId: string,
  task: TaskView,
  title: string,
  nowMs: number,
  pills?: HomeSessionParams
): HomeThreadTarget {
  const base = {
    serverId,
    title,
    taskId: task.taskId,
    setAtMs: nowMs,
    ...(pills ? { pills } : {}),
  };
  const { binding } = task;
  if (binding.kind === 'agent_session')
    return {
      ...base,
      kind: 'session',
      sessionId: HOME_AGENT_SESSION_ID,
      asid: binding.asid,
      agentId: binding.agentId,
    };
  if (binding.kind === 'pane')
    return {
      ...base,
      kind: 'pane',
      sessionId: binding.sessionId,
      paneId: binding.paneId,
      ...(binding.agentId ? { agentLabel: binding.agentId } : {}),
    };
  return { ...base, kind: 'task', taskId: task.taskId };
}

/**
 * A task target once its task says where it runs; the same target otherwise.
 * The task stays attached for its progress line.
 */
export function homeThreadResolved(
  target: HomeThreadTarget,
  task: TaskView | undefined
): HomeThreadTarget {
  if (target.kind !== 'task' || !task || task.binding.kind === 'none') return target;
  if (task.binding.kind === 'peer') return target;
  const resolved = homeThreadTargetFromTask(
    target.serverId,
    task,
    target.title,
    target.setAtMs,
    target.pills
  );
  return target.lastSent
    ? {
        ...resolved,
        lastSent: target.lastSent,
        ...(target.sentAtMs ? { sentAtMs: target.sentAtMs } : {}),
      }
    : resolved;
}

export type HomeThreadSendPlan =
  /** No target: today's create path, which then targets what it made. */
  | { kind: 'create' }
  /** `POST …/prompt` on the session, as the session screen sends a follow-up. */
  | {
      kind: 'session';
      sessionId: string;
      asid: string;
      /** Set while the agent is running: the session screen steers then. */
      delivery?: 'steer';
      switchMode?: string;
      switchModel?: HomeSessionParams['model'];
    }
  /** The pane's agent, the terminal screen's composer path (`agents/{pane}/send`). */
  | { kind: 'pane'; sessionId?: string; paneId: string }
  /** The task was accepted but has not said where it runs yet. */
  | { kind: 'starting' }
  /** Running, and this agent can neither steer nor queue: the session screen refuses too. */
  | { kind: 'busy' }
  /** The session lives in a terminal; the session screen sends the reader there too. */
  | { kind: 'terminal' }
  /** Another computer's mirrored task: only its own computer takes a message. */
  | { kind: 'elsewhere' };

const RUNNING: readonly AgentRunStatus[] = ['busy', 'retry'];

/**
 * What Send does with a draft. With no target, what it always did; with one,
 * a follow-up in that conversation over the path its own screen uses, or the
 * reason it cannot take one now (the draft is kept, nothing is created).
 */
export function homeThreadSendPlan(input: {
  target: HomeThreadTarget | undefined;
  /** The target's ledger task, when it has one and it is in the index. */
  task?: TaskView;
  /** What the live strip last read of the session. */
  live?: { status?: AgentRunStatus; interaction?: AgentSessionRuntime['interaction'] };
  /** The target agent's `inbox` and `promptSteering`. */
  features: { inbox: boolean; steering: boolean };
  /** The dock's mode and model now, when they name the target's own agent. */
  pills?: HomeSessionParams;
}): HomeThreadSendPlan {
  const { features, live } = input;
  if (!input.target) return { kind: 'create' };
  const target = homeThreadResolved(input.target, input.task);
  if (target.kind === 'task')
    return input.task?.binding.kind === 'peer' ? { kind: 'elsewhere' } : { kind: 'starting' };
  if (target.kind === 'pane')
    return {
      kind: 'pane',
      paneId: target.paneId,
      ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    };
  if (live?.interaction === 'terminal') return { kind: 'terminal' };
  const running = live?.status !== undefined && RUNNING.includes(live.status);
  if (running && !features.inbox && !features.steering) return { kind: 'busy' };
  const switches =
    input.pills && target.pills ? homeSessionSwitches(target.pills, input.pills) : {};
  return {
    kind: 'session',
    sessionId: target.sessionId,
    asid: target.asid,
    ...(running ? { delivery: 'steer' as const } : {}),
    ...switches,
  };
}

/** What is known, right now, about whether the target still exists. */
export type HomeThreadFacts = {
  /** The gateway answered "gone" for this session (`useGoneAgentSessions`). */
  goneSession?: boolean;
  /** A snapshot read answered 404, or the session reported itself deleted. */
  notFound?: boolean;
  /** The agents this computer lists, when it has listed them. */
  agentIds?: readonly string[];
  /** The computer's pane mirror, if any. */
  panes?: ServerAgentsSnapshot;
  /** The target's ledger task, when it is in the index. */
  task?: TaskView;
};

/**
 * Whether the conversation has ended: deleted or not found, its agent no
 * longer on the computer, its pane gone or now running another agent, its
 * task cancelled. Idle and done are not ended -- a finished task reopens when
 * the reader keeps talking. A mirror older than the target says nothing.
 */
export function homeThreadEnded(target: HomeThreadTarget, facts: HomeThreadFacts): boolean {
  // A cancelled task ends a task that never said where it runs; a session or
  // pane it ran in is still there to talk to (talking reopens the task).
  if (target.kind === 'task') return facts.task?.state === 'cancelled';
  if (target.kind === 'session') {
    if (facts.goneSession || facts.notFound) return true;
    const agentId = target.agentId?.trim().toLowerCase();
    if (agentId && facts.agentIds && facts.agentIds.length > 0)
      return !facts.agentIds.some((listed) => listed.toLowerCase() === agentId);
    return false;
  }
  if (target.kind === 'pane') {
    const panes = facts.panes;
    if (!panes || panes.serverId !== target.serverId || panes.checkedAtMs < target.setAtMs)
      return false;
    if (target.sessionId && panes.sessionId && panes.sessionId !== target.sessionId) return false;
    const row = panes.agents.find((agent) => agent.paneId === target.paneId);
    if (!row || !row.hasAgent) return true;
    return Boolean(target.instanceId && row.instanceId && row.instanceId !== target.instanceId);
  }
  return false;
}

/** The persisted `{ [serverId]: target }`, dropping anything malformed. */
export function parseHomeThreads(
  value: string | null | undefined
): Record<string, HomeThreadTarget> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, HomeThreadTarget> = {};
  for (const [serverId, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const target = normalizeTarget(raw);
    if (target && target.serverId === serverId) out[serverId] = target;
  }
  return out;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeTarget(raw: unknown): HomeThreadTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const serverId = text(rec.serverId);
  const title = typeof rec.title === 'string' ? rec.title : '';
  const setAtMs = typeof rec.setAtMs === 'number' && Number.isFinite(rec.setAtMs) ? rec.setAtMs : 0;
  if (!serverId) return null;
  const taskId = text(rec.taskId);
  const lastSent = text(rec.lastSent);
  const sentAtMs =
    typeof rec.sentAtMs === 'number' && Number.isFinite(rec.sentAtMs) ? rec.sentAtMs : undefined;
  const pills = normalizePills(rec.pills);
  const base = {
    serverId,
    title,
    setAtMs,
    ...(taskId ? { taskId } : {}),
    ...(lastSent ? { lastSent } : {}),
    ...(lastSent && sentAtMs ? { sentAtMs } : {}),
    ...(pills ? { pills } : {}),
  };
  if (rec.kind === 'session') {
    const sessionId = text(rec.sessionId);
    const asid = text(rec.asid);
    if (!sessionId || !asid) return null;
    const agentId = text(rec.agentId);
    const directory = text(rec.directory);
    return {
      ...base,
      kind: 'session',
      sessionId,
      asid,
      ...(agentId ? { agentId } : {}),
      ...(directory ? { directory } : {}),
    };
  }
  if (rec.kind === 'pane') {
    const paneId = text(rec.paneId);
    if (!paneId) return null;
    const sessionId = text(rec.sessionId);
    const agentLabel = text(rec.agentLabel);
    const instanceId = text(rec.instanceId);
    return {
      ...base,
      kind: 'pane',
      paneId,
      ...(sessionId ? { sessionId } : {}),
      ...(agentLabel ? { agentLabel } : {}),
      ...(instanceId ? { instanceId } : {}),
    };
  }
  if (rec.kind === 'task' && taskId) return { ...base, kind: 'task', taskId };
  return null;
}

function normalizePills(value: unknown): HomeSessionParams | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const mode = text(rec.mode);
  const agentId = text(rec.agentId);
  const model = rec.model as Record<string, unknown> | undefined;
  const ref =
    model && typeof model.provider_id === 'string' && typeof model.model_id === 'string'
      ? {
          provider_id: model.provider_id,
          model_id: model.model_id,
          ...(typeof model.variant === 'string' ? { variant: model.variant } : {}),
        }
      : undefined;
  return {
    ...(mode ? { mode } : {}),
    ...(ref ? { model: ref } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

// ---------------------------------------------------------------------------
// The live strip: what the session screen's own snapshot and events say.
// ---------------------------------------------------------------------------

export type HomeThreadLive = {
  status?: AgentRunStatus;
  interaction?: AgentSessionRuntime['interaction'];
  title?: string;
  titleUpdatedMs?: number;
  /** The session reported itself deleted. */
  deleted?: boolean;
  permissions: readonly PermissionRequest[];
  forms: readonly FormRequest[];
  /** The pane's own screen shows the agent at work (a spinner, "esc to interrupt"). */
  paneBusy?: boolean;
  /**
   * A session's current activity, from its timeline (`sessionActivity`): its
   * newest tool call or words, and when the engine last updated them.
   */
  activity?: { text: string; atMs: number };
};

export const EMPTY_HOME_THREAD_LIVE: HomeThreadLive = { permissions: [], forms: [] };

/** Display metadata must never select or change the recipient of a reply. */
export function homeThreadTitle(
  target: HomeThreadTarget | undefined,
  live: Pick<HomeThreadLive, 'title' | 'titleUpdatedMs'> | undefined,
  listing: GatewayAgentSessionsSnapshot | undefined
): string | undefined {
  if (!target) return undefined;
  const matches =
    target.kind === 'session' && listing?.serverId === target.serverId
      ? listing.sessions.filter(
          (row) => row.asid === target.asid && (!target.agentId || row.agentId === target.agentId)
        )
      : [];
  const listed = matches.length === 1 ? matches[0] : undefined;
  if (
    listed?.title.trim() &&
    (!live?.title?.trim() || listed.updatedMs >= (live.titleUpdatedMs ?? 0))
  )
    return listed.title.trim();
  return (
    live?.title?.trim() ||
    target.title.trim() ||
    (target.kind === 'session'
      ? target.asid
      : target.kind === 'pane'
        ? target.paneId
        : target.taskId)
  );
}

/** The live state from a snapshot read (on subscribe, resync and reconnect). */
export function homeThreadLiveFromSnapshot(snapshot: AgentSessionSnapshot): HomeThreadLive {
  const info = snapshot.info;
  return {
    ...(info ? { status: info.status, title: info.title, titleUpdatedMs: info.updated_ms } : {}),
    ...(info?.runtime ? { interaction: info.runtime.interaction } : {}),
    ...(info?.deleted ? { deleted: true } : {}),
    permissions: snapshot.permissions,
    forms: snapshot.forms,
    ...withActivity(sessionActivity(snapshot.timeline)),
  };
}

function withActivity(activity: HomeThreadLive['activity']) {
  return activity ? { activity } : {};
}

/** One event folded in, as the session screen folds it into its transcript. */
export function applyHomeThreadEvent(
  live: HomeThreadLive,
  event: AgentDomainEvent
): HomeThreadLive {
  switch (event.type) {
    case 'agent.session.updated': {
      const { info } = event;
      return {
        ...live,
        status: info.status,
        title: info.title,
        titleUpdatedMs: info.updated_ms,
        ...(info.runtime ? { interaction: info.runtime.interaction } : {}),
        ...(info.deleted ? { deleted: true } : {}),
      };
    }
    case 'agent.status.changed':
      return { ...live, status: event.status };
    case 'agent.timeline.upsert': {
      const activity = sessionActivity(event.items);
      if (!activity || (live.activity && activity.atMs < live.activity.atMs)) return live;
      if (live.activity?.text === activity.text) return live;
      return { ...live, activity };
    }
    case 'agent.permission.pending':
      return live.permissions.some((request) => request.id === event.request.id)
        ? live
        : { ...live, permissions: [...live.permissions, event.request] };
    case 'agent.permission.resolved':
      return {
        ...live,
        permissions: live.permissions.filter((request) => request.id !== event.request_id),
      };
    case 'agent.form.pending':
      return live.forms.some((form) => form.id === event.request.id)
        ? live
        : { ...live, forms: [...live.forms, event.request] };
    case 'agent.form.resolved':
      return { ...live, forms: live.forms.filter((form) => form.id !== event.form_id) };
    default:
      return live;
  }
}

/** The ledger task the target runs as: by id, else the newest one bound to its session or pane. */
export function homeThreadTask(
  target: HomeThreadTarget,
  tasks: readonly TaskView[] | undefined
): TaskView | undefined {
  if (!tasks) return undefined;
  if (target.taskId) {
    const byId = tasks.find((task) => task.taskId === target.taskId);
    if (byId) return byId;
  }
  let found: TaskView | undefined;
  for (const task of tasks) {
    const { binding } = task;
    const bound =
      (target.kind === 'session' &&
        binding.kind === 'agent_session' &&
        binding.asid === target.asid) ||
      (target.kind === 'pane' && binding.kind === 'pane' && binding.paneId === target.paneId);
    if (bound && (!found || task.updatedMs > found.updatedMs)) found = task;
  }
  return found;
}

export type HomeThreadState = 'needs-you' | 'working' | 'idle' | 'failed' | 'starting';

/**
 * The strip's one word, from what was reported: a request or a waiting task
 * needs the reader; a run or an open task is working; a run that failed says
 * so; anything else is idle. Never "done": idle is not completion.
 */
export function homeThreadState(input: {
  live?: Pick<HomeThreadLive, 'status' | 'permissions' | 'forms'>;
  task?: Pick<TaskView, 'state'>;
  pane?: { status?: AgentStatus; pendingUserInput?: boolean; busy?: boolean };
  /** A task target that has not said where it runs. */
  unbound?: boolean;
}): HomeThreadState {
  const { live, task, pane } = input;
  const blockingForm = live?.forms.some((form) => form.nonblocking !== true) ?? false;
  if (
    (live?.permissions.length ?? 0) > 0 ||
    blockingForm ||
    task?.state === 'waiting' ||
    pane?.status === 'blocked' ||
    pane?.pendingUserInput === true
  )
    return 'needs-you';
  if (input.unbound) return 'starting';
  // The pane's own screen showing the agent at work is evidence ahead of the mirror.
  if (pane?.busy) return 'working';
  if (live?.status && RUNNING.includes(live.status)) return 'working';
  if (live?.status === 'failed') return 'failed';
  if (live?.status === undefined) {
    if (task && ['queued', 'dispatching', 'working'].includes(task.state)) return 'working';
    if (task?.state === 'failed') return 'failed';
    if (pane?.status === 'working') return 'working';
  }
  return 'idle';
}

/** How long after a send a pane is re-read for its reply. */
export const HOME_THREAD_SENT_WINDOW_MS = 10 * 60_000;

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether a pane's reply answers `lastSent`: the reader's message the pane
 * shows above the reply starts as the one sent (a wrapped or cut prompt line
 * is compared by its beginning). Nothing sent: whatever the pane shows.
 */
export function homeThreadPaneAnswers(
  prompt: string | undefined,
  lastSent: string | undefined
): boolean {
  if (!lastSent) return true;
  if (!prompt) return false;
  const shown = normalized(prompt);
  const sent = normalized(lastSent);
  const length = Math.min(shown.length, sent.length, 24);
  return length >= Math.min(6, sent.length) && shown.slice(0, length) === sent.slice(0, length);
}

/** A send still waiting for anything newer to show. */
function awaitingReply(target: Pick<ThreadBase, 'lastSent' | 'sentAtMs'>, nowMs: number): boolean {
  return (
    target.lastSent !== undefined &&
    target.sentAtMs !== undefined &&
    nowMs - target.sentAtMs < HOME_THREAD_SENT_WINDOW_MS
  );
}

/**
 * Whether a pane target is read again after a send: within the window,
 * while its reply to the send has not appeared or its agent is still at
 * work. Idle with the reply shown, or the window over, stops it.
 */
export function homeThreadPanePolls(input: {
  target: HomeThreadTarget;
  nowMs: number;
  answered: boolean;
  working: boolean;
}): boolean {
  return (
    input.target.kind === 'pane' &&
    awaitingReply(input.target, input.nowMs) &&
    (!input.answered || input.working)
  );
}
