/**
 * What the Stage floats over its art for the selected computer: the one
 * thing waiting on the reader (the needs-you card), else what a working
 * agent last reported (the progress subtitle). Pure: it reads only state Home
 * already keeps -- the dock's live conversation, the attention observations,
 * the task ledger, the pane mirror -- and fetches nothing. Nothing is made
 * up: no request without a source, no progress line nobody reported, and an
 * idle agent says nothing.
 */
import type { FormRequest, PermissionRequest } from './agent-protocol';
import type { HomeAttentionSnapshot } from './home-attention';
import { homeTargetAgentId } from './home-recents';
import { isServerAgentsStale, type ServerAgent, type ServerAgentsSnapshot } from './server-agents';
import type { TaskView } from './task-ledger';

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
  /** Which agent is speaking: a change of speaker is a new line. */
  key: string;
  text: string;
  atMs: number;
};

/** What the dock's pane conversation last showed of its agent at work. */
export type StagePaneLineInput = {
  paneId: string;
  agentLabel?: string;
  text: string;
  atMs: number;
};

function clean(text: string | undefined): string | undefined {
  const line = text?.replace(/\s+/g, ' ').trim();
  return line ? line : undefined;
}

/**
 * The most recently reported progress of an agent working on `serverId`:
 * a working ledger task's own progress line, or the dock's pane agent's last
 * words while its screen shows it at work. A task whose pane the fresh mirror
 * shows idle or done is not working, whatever its last line said. Null when
 * nothing working reported anything.
 */
export function stageProgress(input: {
  tasks: readonly TaskView[];
  panes?: ServerAgentsSnapshot;
  paneLine?: StagePaneLineInput;
  nowMs: number;
}): StageProgress | null {
  const agents = freshAgents(input.panes, input.nowMs);
  let best: StageProgress | null = null;
  const consider = (line: StageProgress) => {
    if (!best || line.atMs > best.atMs) best = line;
  };
  for (const task of input.tasks) {
    if (task.state !== 'working') continue;
    const text = clean(task.progress);
    if (!text) continue;
    const { binding } = task;
    const pane =
      binding.kind === 'pane' ? agents.find((agent) => agent.paneId === binding.paneId) : undefined;
    if (pane && pane.status !== 'working') continue;
    const agentId =
      binding.kind === 'agent_session' || binding.kind === 'pane' ? binding.agentId : undefined;
    consider({
      ...(pane?.agentLabel ? { agentLabel: pane.agentLabel } : {}),
      ...(agentId ? { agentId } : {}),
      key:
        binding.kind === 'pane'
          ? `pane:${binding.paneId}`
          : binding.kind === 'agent_session'
            ? `session:${binding.asid}`
            : `task:${task.taskId}`,
      text,
      atMs: task.updatedMs,
    });
  }
  const paneLine = input.paneLine;
  const paneText = clean(paneLine?.text);
  if (paneLine && paneText) {
    const pane = agents.find((agent) => agent.paneId === paneLine.paneId);
    const label = pane?.agentLabel ?? paneLine.agentLabel;
    // The mirror has seen it stop since the screen was read.
    if (!pane || pane.status === 'working')
      consider({
        ...(label ? { agentLabel: label } : {}),
        key: `pane:${paneLine.paneId}`,
        text: paneText,
        atMs: paneLine.atMs,
      });
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
