/**
 * What the Stage floats over its art for the selected computer: the one
 * thing waiting on the reader (the needs-you card), else what a working
 * agent last reported (the progress subtitle). Pure: it reads only state Home
 * already keeps -- the dock's live conversation, the attention observations,
 * the task ledger, the pane mirror -- and fetches nothing. Nothing is made
 * up: no request without a source, no progress line nobody reported, and an
 * idle agent says nothing.
 */
import type {
  AgentRunStatus,
  FormRequest,
  PermissionRequest,
  TimelineItem,
  ToolPart,
} from './agent-protocol';
import { toolInputRecord } from './agent-tool-output';
import type { GatewayAgentSessionsSnapshot } from './home-continue';
import { isHiddenMuqunTool } from './internal-muqun-tools';
import type { HomeAttentionSnapshot } from './home-attention';
import { homeTargetAgentId } from './home-recents';
import {
  isServerAgentsStale,
  MAX_SERVER_AGENTS,
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgent,
  type ServerAgentsSnapshot,
} from './server-agents';
import type { TaskView } from './task-ledger';
import { stageProgressSession } from './stage-progress-session';

type SessionTarget = HomeAttentionSnapshot['target'];

/** Who is asking: an agent id to name through discovery, or a name the gateway gave. */
type Asker = { agentId?: string; agentLabel?: string };

export type StageNeed = Asker & {
  /** Stable while the request stands: the card's identity. */
  key: string;
  /** When it was last seen asking, for "most recent". */
  atMs: number;
} & (
    | {
        /** A permission in the dock's conversation: answerable in place. */
        kind: 'permission';
        request: PermissionRequest;
        target: SessionTarget;
      }
    | {
        /** A blocking question in the dock's conversation. */
        kind: 'question';
        form: FormRequest;
        target: SessionTarget;
      }
    | {
        /** Requests seen on another session: only their count is known here. */
        kind: 'requests';
        count: number;
        target: SessionTarget;
      }
    | {
        /** A ledger task waiting on the reader (`homeWaitingTasks`). */
        kind: 'task';
        task: TaskView;
      }
    | {
        /** A terminal agent blocked or asking: it is answered in its pane. */
        kind: 'pane';
        paneId?: string;
      }
  );

/** The dock's conversation on this computer, as its live feed last read it. */
export type StageThreadInput = {
  target: SessionTarget;
  permissions: readonly PermissionRequest[];
  forms: readonly FormRequest[];
};

export type StageNeeds = {
  /** The most recent request; null when nothing waits. */
  top: StageNeed | null;
  /** How many others wait behind it ("+N more"). */
  more: number;
};

function paneNeedsYou(agent: ServerAgent): boolean {
  return agent.hasAgent && (agent.status === 'blocked' || agent.pendingUserInput === true);
}

/** The mirror's agents, only while it is fresh: an old mirror says nothing about now. */
function freshAgents(panes: ServerAgentsSnapshot | undefined, nowMs: number): ServerAgent[] {
  return panes && !isServerAgentsStale(panes, nowMs) ? panes.agents : [];
}

/**
 * What waits on the reader on `serverId`, most recent first. The dock's own
 * conversation carries its requests' content; another session's observation
 * only its count; ledger tasks and blocked panes their own line.
 *
 * A native request and its agent's blocked pane are usually one wait seen
 * twice, so the total is the larger of the two sides, never the sum (as the
 * HUD's "N need you" counts); a pane whose ledger task is already listed is
 * that task.
 */
export function stageNeeds(input: {
  serverId: string;
  thread?: StageThreadInput;
  observations: Readonly<Record<string, HomeAttentionSnapshot>>;
  /** This computer's waiting tasks, as `homeWaitingTasks` lists them. */
  waitingTasks: readonly TaskView[];
  panes?: ServerAgentsSnapshot;
  nowMs: number;
}): StageNeeds {
  const { serverId, thread, nowMs } = input;
  const listed: StageNeed[] = [];
  const add = (need: StageNeed) => listed.push(need);
  let sessionCount = 0;

  const threadTarget = thread?.target.serverId === serverId ? thread.target : undefined;
  const threadSeen = threadTarget
    ? Object.values(input.observations).find(
        (snapshot) =>
          snapshot.target.serverId === serverId && snapshot.target.asid === threadTarget.asid
      )?.observedAt
    : undefined;
  const threadAgent = threadTarget ? { agentId: homeTargetAgentId(threadTarget) } : {};
  let threadAsks = false;
  if (thread && threadTarget) {
    // Seen live in the conversation now; later entries arrived later.
    const atMs = threadSeen ?? nowMs;
    for (const request of thread.permissions) {
      add({
        ...threadAgent,
        kind: 'permission',
        key: `permission:${threadTarget.asid}:${request.id}`,
        atMs,
        request,
        target: threadTarget,
      });
      sessionCount += 1;
    }
    for (const form of thread.forms) {
      if (form.nonblocking === true) continue;
      add({
        ...threadAgent,
        kind: 'question',
        key: `question:${threadTarget.asid}:${form.id}`,
        atMs,
        form,
        target: threadTarget,
      });
      sessionCount += 1;
    }
    threadAsks = sessionCount > 0;
  }

  for (const [key, snapshot] of Object.entries(input.observations)) {
    const { target } = snapshot;
    if (target.serverId !== serverId || snapshot.requestIds.length === 0) continue;
    // The live conversation says it better, with the request itself.
    if (threadAsks && threadTarget && target.asid === threadTarget.asid) continue;
    add({
      agentId: homeTargetAgentId(target),
      kind: 'requests',
      key: `requests:${key}`,
      atMs: snapshot.observedAt,
      count: snapshot.requestIds.length,
      target,
    });
    sessionCount += snapshot.requestIds.length;
  }

  const agents = freshAgents(input.panes, nowMs);
  const taskPanes = new Set<string>();
  for (const task of input.waitingTasks) {
    const { binding } = task;
    if (
      threadAsks &&
      threadTarget &&
      binding.kind === 'agent_session' &&
      binding.asid === threadTarget.asid
    )
      continue;
    if (binding.kind === 'pane') taskPanes.add(binding.paneId);
    const pane =
      binding.kind === 'pane' ? agents.find((agent) => agent.paneId === binding.paneId) : undefined;
    const agentId =
      binding.kind === 'agent_session' || binding.kind === 'pane' ? binding.agentId : undefined;
    add({
      ...(pane?.agentLabel ? { agentLabel: pane.agentLabel } : {}),
      ...(agentId ? { agentId } : {}),
      kind: 'task',
      key: `task:${task.taskId}`,
      atMs: task.updatedMs,
      task,
    });
    sessionCount += 1;
  }

  let paneCount = 0;
  for (const agent of agents) {
    if (!paneNeedsYou(agent)) continue;
    paneCount += 1;
    if (agent.paneId && taskPanes.has(agent.paneId)) continue;
    add({
      agentLabel: agent.agentLabel ?? agent.name,
      kind: 'pane',
      key: `pane:${agent.id}`,
      atMs: input.panes?.checkedAtMs ?? 0,
      ...(agent.paneId ? { paneId: agent.paneId } : {}),
    });
  }

  // Most recent first; between equals, the one listed later arrived later.
  let top: StageNeed | null = null;
  for (const need of listed) if (!top || need.atMs >= top.atMs) top = need;
  if (!top) return { top: null, more: 0 };
  return { top, more: Math.max(0, Math.max(sessionCount, paneCount) - 1) };
}

/** A question with one choice to make, answerable from a row of buttons. */
export type StageChoice = { key: string; options: readonly { value: string; label: string }[] };

/** Most options a question may offer and still be answered from the card. */
export const STAGE_CHOICE_MAX = 3;

/**
 * The single choice a question asks for, when that is all it asks: one
 * unconditional text field with a short list of options and no free answer.
 * Anything more is answered in the conversation.
 */
export function stageSingleChoice(form: FormRequest): StageChoice | null {
  if (form.fields.length !== 1) return null;
  const field = form.fields[0]!;
  if (field.type !== 'string' || field.when.length > 0 || field.custom === true) return null;
  const options = field.options ?? [];
  if (options.length === 0 || options.length > STAGE_CHOICE_MAX) return null;
  return {
    key: field.key,
    options: options.map((option) => ({ value: option.value, label: option.label })),
  };
}

// -- The progress subtitle ---------------------------------------------------

export type StageProgress = Asker & {
  /** Opaque conversation ID, kept separate from the provider-scoped display key. */
  asid?: string;
  /** The pane incarnation that produced this line, never inferred from its name. */
  terminal?: { sessionId: string; instanceId?: string; shellPid?: number };
  /** Which agent is speaking: a change of speaker is a new line. */
  key: string;
  text: string;
  atMs: number;
};

/**
 * What the followed agent is doing now (`stageActivitySubject`), as read off
 * its screen or its session stream, and when it was read.
 */
export type StageActivityInput = Asker & {
  asid?: string;
  key: string;
  text: string;
  atMs: number;
  /** A pane agent's pane: the mirror can say it has stopped since. */
  paneId?: string;
};

function clean(text: string | undefined): string | undefined {
  const line = text?.replace(/\s+/g, ' ').trim();
  return line ? line : undefined;
}

/**
 * The most recently reported progress of an agent working on `serverId`:
 * a working ledger task's own progress line, or the followed agent's current
 * activity (`activity`) while it works. A task whose pane the fresh mirror
 * shows idle or done is not working, whatever its last line said. Null when
 * nothing working reported anything.
 */
type StageProgressInput = {
  serverId?: string;
  tasks: readonly TaskView[];
  panes?: ServerAgentsSnapshot;
  activity?: StageActivityInput;
  activities?: readonly StageActivityInput[];
  sessions?: GatewayAgentSessionsSnapshot;
  nowMs: number;
};

/** Working conversations, once each, in stable identity order rather than update order. */
export function stageProgressLines(input: StageProgressInput): StageProgress[] {
  const serverId = input.serverId ?? input.panes?.serverId ?? input.sessions?.serverId;
  const panes = input.panes?.serverId === serverId ? input.panes : undefined;
  const agents = freshAgents(panes, input.nowMs);
  const sessions =
    input.sessions &&
    input.sessions.serverId === serverId &&
    input.nowMs - input.sessions.observedAtMs <= SERVER_AGENTS_STALE_AFTER_MS
      ? input.sessions
      : undefined;
  const lines = new Map<string, StageProgress>();
  const consider = (line: StageProgress) => {
    // Use the same scoped, incarnation-checked mapping as a subtitle tap.
    const entry =
      line.terminal && serverId
        ? stageProgressSession({ line, serverId, entries: [], sessions, panes, nowMs: input.nowMs })
        : null;
    if (entry?.destination.type === 'agent-session') {
      const target = entry.destination.target;
      line = {
        ...line,
        key: stageSessionKey(target.asid, target.agentId),
        asid: target.asid,
        agentId: target.agentId,
      };
    }
    const previous = lines.get(line.key);
    if (!previous || line.atMs > previous.atMs) lines.set(line.key, line);
  };
  for (const task of input.tasks) {
    if (task.state !== 'working') continue;
    const text = clean(task.progress);
    if (!text) continue;
    const { binding } = task;
    if (binding.kind === 'agent_session' && sessions && sessions.observedAtMs >= task.updatedMs) {
      const reported = sessions.sessions.find(
        (session) => session.asid === binding.asid && session.agentId === binding.agentId
      );
      if (reported && !RUNNING_SESSION.includes(reported.status as AgentRunStatus)) continue;
    }
    const pane =
      binding.kind === 'pane' ? agents.find((agent) => agent.paneId === binding.paneId) : undefined;
    if (binding.kind === 'pane') {
      if (panes?.sessionId && panes.sessionId !== binding.sessionId) continue;
      if (
        pane &&
        (pane.status !== 'working' || (binding.shellPid && pane.shellPid !== binding.shellPid))
      )
        continue;
      if (
        panes?.sessionId === binding.sessionId &&
        !isServerAgentsStale(panes, input.nowMs) &&
        !pane &&
        panes.agents.length < MAX_SERVER_AGENTS
      )
        continue;
      const associated = sessions?.sessions.filter(
        (session) =>
          session.terminal?.sessionId === binding.sessionId &&
          session.terminal?.paneId === binding.paneId &&
          (!binding.agentId || session.agentId === binding.agentId)
      );
      if (
        sessions &&
        sessions.observedAtMs >= task.updatedMs &&
        associated?.length === 1 &&
        !RUNNING_SESSION.includes(associated[0]!.status as AgentRunStatus)
      )
        continue;
    }
    const agentId =
      binding.kind === 'agent_session' || binding.kind === 'pane' ? binding.agentId : undefined;
    consider({
      ...(pane?.agentLabel ? { agentLabel: pane.agentLabel } : {}),
      ...(agentId ? { agentId } : {}),
      ...(binding.kind === 'pane'
        ? {
            terminal: {
              sessionId: binding.sessionId,
              ...(binding.shellPid ? { shellPid: binding.shellPid } : {}),
              ...(panes?.sessionId === binding.sessionId &&
              (!binding.shellPid || pane?.shellPid === binding.shellPid)
                ? {
                    ...(pane?.instanceId ? { instanceId: pane.instanceId } : {}),
                    ...(!binding.shellPid && pane?.shellPid ? { shellPid: pane.shellPid } : {}),
                  }
                : {}),
            },
          }
        : {}),
      ...(binding.kind === 'agent_session' ? { asid: binding.asid } : {}),
      key:
        binding.kind === 'pane'
          ? `pane:${binding.paneId}`
          : binding.kind === 'agent_session'
            ? stageSessionKey(binding.asid, binding.agentId)
            : `task:${task.taskId}`,
      text,
      atMs: task.updatedMs,
    });
  }
  for (const activity of [
    ...(input.activities ?? []),
    ...(input.activity ? [input.activity] : []),
  ]) {
    const activityText = clean(activity.text);
    if (!activityText) continue;
    const pane =
      activity.paneId !== undefined
        ? agents.find((agent) => agent.paneId === activity.paneId)
        : undefined;
    const label = pane?.agentLabel ?? activity.agentLabel;
    // The mirror has seen it stop since the screen was read.
    if (!pane || pane.status === 'working')
      consider({
        ...(label ? { agentLabel: label } : {}),
        ...(activity.agentId ? { agentId: activity.agentId } : {}),
        ...(pane && panes?.sessionId
          ? {
              terminal: {
                sessionId: panes.sessionId,
                ...(pane.instanceId ? { instanceId: pane.instanceId } : {}),
                ...(pane.shellPid ? { shellPid: pane.shellPid } : {}),
              },
            }
          : {}),
        ...(activity.asid ? { asid: activity.asid } : {}),
        key: activity.asid ? stageSessionKey(activity.asid, activity.agentId) : activity.key,
        text: activityText,
        atMs: activity.atMs,
      });
  }
  return [...lines.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Compatibility for surfaces that need only the newest reported line. */
export function stageProgress(input: StageProgressInput): StageProgress | null {
  let best: StageProgress | null = null;
  for (const line of stageProgressLines(input)) if (!best || line.atMs > best.atMs) best = line;
  return best;
}

// -- Which agent the subtitle follows ----------------------------------------

/** Provider identity participates even when two providers reuse a conversation ID. */
export function stageSessionKey(asid: string, agentId?: string): string {
  return `session:${JSON.stringify([agentId ?? null, asid])}`;
}

/** A working agent whose current activity the subtitle follows. */
export type StageActivitySubject =
  | { kind: 'pane'; key: string; paneId: string; agentLabel?: string }
  | {
      kind: 'session';
      key: string;
      sessionId: string;
      asid: string;
      agentId?: string;
      /** The dock's own conversation: its live stream is already open. */
      dock: boolean;
    };

/** The dock's conversation on this computer, with its stream's status when it is a session. */
export type StageDockInput =
  | { kind: 'session'; sessionId: string; asid: string; agentId?: string; status?: AgentRunStatus }
  | { kind: 'pane'; paneId: string };

/** The followed agent stays followed while its own activity changed this recently. */
export const STAGE_ACTIVITY_HOLD_MS = 30_000;

const RUNNING_SESSION: readonly AgentRunStatus[] = ['busy', 'retry'];

/**
 * The working agent on `serverId` the subtitle follows: the most recently
 * active one, by what was reported of it -- a session's own update time, a
 * pane's mirror check (or, sharper, when this device last saw its screen
 * change, `activeAtMs`). Only working agents count: a pane the fresh mirror
 * shows working with an agent and nothing asked, a session the gateway lists
 * as running (the dock's own session by its live stream's status, which is
 * newer). A session drawn in a pane is that pane's work, followed once, as a
 * session. Between equals the dock's own conversation goes first.
 *
 * The agent already followed (`current`) is kept while it still works and its
 * activity changed within `STAGE_ACTIVITY_HOLD_MS`, so two busy agents do not
 * trade the line at every mirror refresh. Null when nothing works.
 */
type StageActivitySubjectsInput = {
  serverId: string;
  panes?: ServerAgentsSnapshot;
  sessions?: GatewayAgentSessionsSnapshot;
  dock?: StageDockInput;
  current?: string;
  activeAtMs: Readonly<Record<string, number>>;
  nowMs: number;
};

function rankedStageActivitySubjects(input: StageActivitySubjectsInput) {
  const { serverId, dock, activeAtMs, nowMs } = input;
  const ranked: { subject: StageActivitySubject; atMs: number; dock: boolean }[] = [];
  const sessions =
    input.sessions?.serverId === serverId &&
    nowMs - input.sessions.observedAtMs <= SERVER_AGENTS_STALE_AFTER_MS
      ? input.sessions
      : undefined;
  const sessionPanes = new Set<string>();
  const rawDock = dock?.kind === 'session' ? dock : undefined;
  const dockOwners =
    rawDock && !rawDock.agentId
      ? sessions?.sessions.filter((session) => session.asid === rawDock.asid)
      : undefined;
  // Older dock records may omit the provider; repair only an unambiguous owner.
  const dockSession =
    rawDock && dockOwners?.length === 1 ? { ...rawDock, agentId: dockOwners[0]!.agentId } : rawDock;
  const seenSessions = new Set<string>();
  const addSession = (
    session: { sessionId: string; asid: string; agentId?: string },
    updatedMs: number
  ) => {
    const key = stageSessionKey(session.asid, session.agentId);
    if (seenSessions.has(key)) return;
    seenSessions.add(key);
    const isDock = dockSession?.asid === session.asid && dockSession.agentId === session.agentId;
    ranked.push({
      subject: {
        kind: 'session',
        key,
        sessionId: session.sessionId,
        asid: session.asid,
        ...(session.agentId ? { agentId: session.agentId } : {}),
        dock: isDock,
      },
      atMs: Math.max(updatedMs, activeAtMs[key] ?? 0),
      dock: isDock,
    });
  };
  // The dock's live stream says more recently than the listing whether it runs.
  if (dockSession?.status !== undefined && RUNNING_SESSION.includes(dockSession.status))
    addSession(
      dockSession,
      sessions?.sessions.find(
        (row) => row.asid === dockSession.asid && row.agentId === dockSession.agentId
      )?.updatedMs ?? 0
    );
  for (const session of sessions?.sessions ?? []) {
    if (
      session.terminal &&
      input.panes?.serverId === serverId &&
      session.terminal.sessionId === input.panes.sessionId &&
      sessions!.observedAtMs >= input.panes.checkedAtMs
    )
      sessionPanes.add(session.terminal.paneId);
    if (
      dockSession?.asid === session.asid &&
      dockSession.agentId === session.agentId &&
      dockSession.status !== undefined
    )
      continue;
    if (!RUNNING_SESSION.includes(session.status as AgentRunStatus)) continue;
    addSession(
      { sessionId: sessions!.sessionId, asid: session.asid, agentId: session.agentId },
      session.updatedMs
    );
  }
  const checkedAtMs = input.panes?.checkedAtMs ?? 0;
  for (const agent of freshAgents(
    input.panes?.serverId === serverId ? input.panes : undefined,
    nowMs
  )) {
    if (!agent.hasAgent || agent.status !== 'working' || !agent.paneId) continue;
    if (paneNeedsYou(agent) || sessionPanes.has(agent.paneId)) continue;
    const key = `pane:${agent.paneId}`;
    const isDock = dock?.kind === 'pane' && dock.paneId === agent.paneId;
    ranked.push({
      subject: {
        kind: 'pane',
        key,
        paneId: agent.paneId,
        ...(agent.agentLabel ? { agentLabel: agent.agentLabel } : {}),
      },
      atMs: Math.max(checkedAtMs, activeAtMs[key] ?? 0),
      dock: isDock,
    });
  }
  return ranked;
}

/** Subscribe to at most five stable speakers, so stream updates never reorder the rows. */
export function stageActivitySubjects(input: StageActivitySubjectsInput): StageActivitySubject[] {
  return rankedStageActivitySubjects(input)
    .map((row) => row.subject)
    .sort((a, b) =>
      a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === 'session' ? -1 : 1
    )
    .slice(0, 5);
}

export function stageActivitySubject(
  input: StageActivitySubjectsInput
): StageActivitySubject | null {
  const ranked = rankedStageActivitySubjects(input);
  const { activeAtMs, nowMs } = input;
  if (input.current) {
    const held = ranked.find((row) => row.subject.key === input.current);
    const changedAtMs = activeAtMs[input.current];
    if (held && changedAtMs !== undefined && nowMs - changedAtMs <= STAGE_ACTIVITY_HOLD_MS)
      return held.subject;
  }
  let best: (typeof ranked)[number] | undefined;
  for (const row of ranked)
    if (!best || row.atMs > best.atMs || (row.atMs === best.atMs && row.dock && !best.dock))
      best = row;
  return best?.subject ?? null;
}

// -- A session's activity, from its timeline ---------------------------------

/** The longest activity line kept: the subtitle shows two lines of it. */
const ACTIVITY_MAX = 280;

function capitalized(name: string): string {
  return name ? `${name[0]!.toUpperCase()}${name.slice(1)}` : name;
}

/** The argument a tool call reads as: its title, else its main input. */
function toolArgument(part: ToolPart): string | undefined {
  const title = clean(part.title);
  if (title) return title;
  const input = toolInputRecord(part.input);
  for (const key of [
    'command',
    'filePath',
    'file_path',
    'path',
    'pattern',
    'url',
    'query',
    'description',
  ]) {
    const value = input?.[key];
    if (typeof value === 'string' && clean(value)) return clean(value);
  }
  return undefined;
}

function capped(text: string): string {
  return text.length > ACTIVITY_MAX ? `${text.slice(0, ACTIVITY_MAX - 1).trimEnd()}…` : text;
}

/**
 * What a session agent is doing now, from its timeline: its newest assistant
 * part -- a tool call as "Bash: bun test src", or its words as their last
 * line. Reasoning, internal tools and empty parts say nothing; the newest
 * part that says something wins (by update time, then order).
 */
export function sessionActivity(
  items: readonly TimelineItem[]
): { text: string; atMs: number } | undefined {
  let best: { text: string; atMs: number } | undefined;
  for (const item of items) {
    if (item.role !== 'assistant') continue;
    if (best && item.updated_ms < best.atMs) continue;
    const { part } = item;
    let text: string | undefined;
    if (part.type === 'tool') {
      if (isHiddenMuqunTool(part)) continue;
      const argument = toolArgument(part);
      text = argument ? `${capitalized(part.name)}: ${argument}` : capitalized(part.name);
    } else if (part.type === 'text') {
      text = part.text
        .split('\n')
        .map((line) => clean(line))
        .filter((line): line is string => Boolean(line))
        .at(-1);
    }
    if (!text) continue;
    best = { text: capped(text), atMs: item.updated_ms };
  }
  return best;
}

/** A subtitle's text changes at most this often; it appears and leaves at once. */
export const STAGE_SUBTITLE_MIN_MS = 2_000;

/**
 * What the subtitle does with a new line: show it now, or wait `waitMs`
 * before showing whatever is newest then. A first line and a cleared one go
 * at once -- arriving and leaving are not churn -- and the same text is no
 * change at all.
 */
export function stageSubtitleStep(input: {
  shown: Pick<StageProgress, 'key' | 'text'> | null;
  shownAtMs: number;
  next: Pick<StageProgress, 'key' | 'text'> | null;
  nowMs: number;
  minMs?: number;
}): { kind: 'keep' } | { kind: 'show' } | { kind: 'wait'; waitMs: number } {
  const { shown, next } = input;
  if (!next) return shown ? { kind: 'show' } : { kind: 'keep' };
  if (!shown) return { kind: 'show' };
  if (shown.key === next.key && shown.text === next.text) return { kind: 'keep' };
  const waitMs = input.shownAtMs + (input.minMs ?? STAGE_SUBTITLE_MIN_MS) - input.nowMs;
  return waitMs > 0 ? { kind: 'wait', waitMs } : { kind: 'show' };
}
