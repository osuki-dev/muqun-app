import type { GatewayEntity } from './gateway-entities';
import type { HealthResponse } from './gateway-client';
import { field, panelTitle } from './herdr-entity';
import type { SpawnedAgent } from './agent-spawn';

/** Keep terminal padding from pushing the actual response several screens away. */
export function compactCollaborationOutput(text: string): string {
  return text.replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').trim();
}

/** A timeout does not prove the process failed, nor that a prompt was delivered. */
export function collaborationSpawnOutcome(created: SpawnedAgent) {
  if (created.agentStarted === true && created.promptSubmitted === true) return 'sent';
  if (created.failure?.code === 'agent_not_ready') return 'attention';
  if (created.agentStarted !== true) {
    return ['agent_start_failed', 'agent_kind_mismatch', 'agent_name_lost'].includes(
      created.failure?.code ?? ''
    )
      ? 'start-failed'
      : 'start-unconfirmed';
  }
  return 'delivery-unconfirmed';
}

export type CollaborationContext = {
  serverId: string;
  sessionId: string;
  paneId: string;
  workspaceId?: string;
  tabId?: string;
  cwd?: string;
  /** Shortcut identity only; its draft and instruction snapshot stay off route URLs. */
  commandId?: string;
};

/** In-memory only: preserve an unsent task while checking its terminal. */
export type CollaborationDraft = {
  /** Memory-only editor identity: an old request cannot replace a reopened draft. */
  owner?: symbol;
  references?: import('./agent-command-references').AgentReferenceDraft;
  command?: { name: string };
  context: CollaborationContext;
  prompt: string;
  target: string;
  newAgent: boolean;
  kind: string;
  recoveryPane: string | null;
};

export function collaborationScope(serverId: string, sessionId: string): string {
  return JSON.stringify([serverId, sessionId]);
}

export type CollaborationTask = {
  id: string;
  serverId: string;
  sessionId: string;
  sourcePaneId: string;
  paneId: string;
  agentName: string;
  /** Absent on legacy history: never attach it to a new pane occupant. */
  agentInstanceId?: string;
  prompt: string;
  createdAt: number;
  /** A task records a dispatch, not a claim that a terminal turn completed it. */
  reviewed?: boolean;
  superseded?: boolean;
};

export function supportsCollaboration(kind: string | undefined): boolean {
  return kind === 'herdr';
}

/** What a Gateway calls the ability to hand a task to another assistant. */
export const AGENT_COLLABORATION_CAPABILITY = 'agent_collaboration';

/**
 * Whether a task can be assigned in this session, and if not, what would fix it.
 *
 * The reason matters as much as the verdict, because AGENTS.md asks for an
 * *actionable* explanation and there are two different upgrades behind a no:
 *
 * - `backend` -- this session is not Herdr. Nothing to upgrade; an assignment
 *   binds to an opaque agent instance id and tmux has none. Ordinary terminal
 *   use is unaffected, and the composer says nothing at all.
 * - `unavailable` -- the session's backend is not answering, or `/health` does
 *   not describe it. A transient state, not an upgrade.
 * - `herdr` -- Herdr is there and too old. Update Herdr.
 * - `gateway` -- Herdr is new enough and the Gateway does not offer the
 *   capability. Update the Gateway.
 * - `ready` -- go.
 *
 * ## Why the backend is inspected before the capability
 *
 * It used to read the gateway-wide capability list first, and that was safe
 * only while every gateway announced `agent_collaboration` unconditionally.
 * Gateways now withhold it when no session has a Herdr 0.9.0+ behind it
 * (muqun-gateway `fix/collaboration-capability`), so asking that question first
 * would answer `gateway` for a machine whose Gateway is perfectly current and
 * whose *Herdr* is old -- naming the one upgrade guaranteed not to help, which
 * is the exact failure the composer was fixed for once already.
 *
 * So the session's own backend is settled first, and `gateway` is only reached
 * once Herdr has been found new enough.
 *
 * ## Two gateways, two answers
 *
 * A current gateway answers per session, in `backends[].capabilities`. That is
 * the precise answer and it is preferred whenever the key is present -- the
 * Gateway parsed its own backend's version and is better placed to than a
 * regex here. Its absence is not a `false`: it means a gateway older than the
 * field, and then the version carried in `backends[].version` is read here, as
 * it always was.
 */
export function collaborationAvailability(health: HealthResponse, sessionId: string, kind: string) {
  if (kind !== 'herdr') return 'backend' as const;
  const backend =
    health.backends?.find((item) => item.sessionId === sessionId) ??
    (health.backend?.sessionId === sessionId ? health.backend : undefined);
  if (!backend?.connected || backend.kind !== 'herdr') return 'unavailable' as const;

  // A gateway that answers per session has already done this comparison against
  // the backend it is actually attached to. Withholding it for a session whose
  // backend is a connected Herdr can only mean the version, so the reason is
  // Herdr's -- a gateway too old for the feature has no per-session key to send.
  if (Array.isArray(backend.capabilities))
    return backend.capabilities.includes(AGENT_COLLABORATION_CAPABILITY)
      ? ('ready' as const)
      : ('herdr' as const);

  if (!backend.version) return 'unavailable' as const;
  const version = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(backend.version);
  if (!version) return 'herdr' as const;
  if (!(Number(version[1]) > 0 || Number(version[2]) >= 9)) return 'herdr' as const;
  return health.capabilities?.includes(AGENT_COLLABORATION_CAPABILITY)
    ? ('ready' as const)
    : ('gateway' as const);
}

export type CollaborationAvailability = ReturnType<typeof collaborationAvailability>;

/**
 * What the composer's assignment strip does in this session: whether the toggle
 * that opens it exists at all, and whether opening it shows targets or one
 * sentence naming an upgrade.
 *
 * Pure and here rather than inline in the workspace, because it is the decision
 * the whole feature turns on and it used to be made by a constant. Four cases:
 *
 *  - **Ready, with something to offer.** A gateway that can spawn, or another
 *    assistant already running in this session. The toggle opens the strip.
 *  - **Ready, with nothing to offer.** No toggle: an empty row is not an answer,
 *    and the reader is not owed an explanation for a session that simply has one
 *    terminal in it.
 *  - **Somebody's upgrade** (`gateway`, `herdr`). The toggle opens the strip on a
 *    sentence naming what to update. AGENTS.md asks for an actionable
 *    explanation, and these are the two answers where one exists.
 *  - **Neither** (`backend`, `unavailable`). No toggle and no sentence. tmux has
 *    no agent instance identity to bind an assignment to, so there is nothing to
 *    upgrade and nothing the reader did wrong; ordinary terminal use is
 *    untouched, which is the rule AGENTS.md states for it.
 */
export function assignmentStripState(
  availability: CollaborationAvailability,
  session: { canSpawn: boolean; candidates: number }
): { toggle: boolean; upgrade?: 'gateway' | 'herdr' } {
  if (availability === 'gateway' || availability === 'herdr')
    return { toggle: true, upgrade: availability };
  if (availability !== 'ready') return { toggle: false };
  return { toggle: session.canSpawn || session.candidates > 0 };
}

export function collaborationAgents(
  agents: GatewayEntity[],
  panes: GatewayEntity[],
  sourcePaneId: string,
  workspaceId?: string
) {
  return agents
    .map((agent) => {
      const paneId = field(agent, 'pane_id') || agent.id;
      const pane = panes.find((item) => item.id === paneId);
      return {
        paneId,
        instanceId: field(agent, 'instance_id'),
        name: panelTitle(pane, agent),
        status: agent.status ?? 'unknown',
        cwd: pane?.cwd ?? agent.cwd ?? '',
        sameWorkspace: Boolean(workspaceId && field(pane, 'workspace_id') === workspaceId),
      };
    })
    .filter((agent) => agent.paneId !== sourcePaneId)
    .sort((a, b) => Number(b.sameWorkspace) - Number(a.sameWorkspace));
}

/** Explicit scope: pane ids can repeat on other machines and sessions. */
export function tasksForSession(tasks: CollaborationTask[], serverId: string, sessionId: string) {
  return tasks.filter((task) => task.serverId === serverId && task.sessionId === sessionId);
}

export function taskAgent(task: CollaborationTask, agents: GatewayEntity[]) {
  if (!task.agentInstanceId) return undefined;
  return agents.find(
    (agent) =>
      (field(agent, 'pane_id') || agent.id) === task.paneId &&
      field(agent, 'instance_id') === task.agentInstanceId
  );
}

/** Read-only validation on both sides of a snapshot catches pane reuse mid-read. */
export async function readCollaborationOutput<Output>(
  task: CollaborationTask,
  load: () => Promise<GatewayEntity[]>,
  read: (agent: GatewayEntity) => Promise<Output>,
  assertConnection: () => void
): Promise<Output | null> {
  assertConnection();
  const before = await load();
  assertConnection();
  const agent = taskAgent(task, before);
  if (!agent) return null;
  const text = await read(agent);
  assertConnection();
  const after = await load();
  assertConnection();
  return taskAgent(task, after) ? text : null;
}

/** One current assignment per verified assistant; older dispatches are history. */
export function partitionCollaborationTasks(tasks: CollaborationTask[], agents: GatewayEntity[]) {
  const seen = new Set<string>();
  const current: CollaborationTask[] = [];
  const history: CollaborationTask[] = [];
  for (const task of tasks) {
    const key = task.agentInstanceId;
    if (key && !seen.has(key) && !task.reviewed && !task.superseded && taskAgent(task, agents))
      current.push(task);
    else history.push(task);
    if (key) seen.add(key);
  }
  return { current, history };
}

export function recordCollaborationTask(tasks: CollaborationTask[], task: CollaborationTask) {
  return [
    task,
    ...tasks.map((previous) =>
      task.agentInstanceId &&
      previous.agentInstanceId === task.agentInstanceId &&
      previous.serverId === task.serverId &&
      previous.sessionId === task.sessionId
        ? { ...previous, superseded: true }
        : previous
    ),
  ].slice(0, 40);
}

/**
 * Whether this build can hand a task to an assistant that is already running.
 *
 * It can, and what it is trading to do so is written down here rather than
 * spread across the call sites.
 *
 * The strongest guarantee would be a Gateway that accepts a request bound to an
 * agent *instance* and refuses it if that instance is gone. There is no such
 * contract. Without it the app looks the agent up and then sends, and a pane is
 * mutable, so between the lookup and the write the target could in principle
 * become a different agent.
 *
 * This used to return `false` on the strength of that race, and the result was
 * a feature that never worked at all -- every attempt died with "Update Muqun
 * Gateway to use Agent collaboration", at a point where the Gateway's
 * `agent_collaboration` capability had already been checked and found present,
 * so the one instruction it gave was the one thing guaranteed not to help.
 *
 * What is actually done about the race:
 *
 *  - The destination is captured when the assistant is chosen, carrying the
 *    agent's `instance_id`, and re-verified against a fresh read immediately
 *    before the write. An assistant that has exited, restarted, or been
 *    replaced in its pane fails the check and the task is not sent.
 *  - The opaque `target` used for the write is the one from that fresh read,
 *    never the captured one.
 *  - A write whose acknowledgement is lost is reported as ambiguous and is
 *    never retried, because nothing here can tell a lost reply from a lost
 *    request (AGENTS.md).
 *
 * That is the same bargain the composer has always made with the agent in front
 * of the reader -- `sendInput` checks the pane and not even the instance -- and
 * strictly more careful. Holding collaboration to a standard the composer does
 * not meet, and calling the difference safety, bought nothing and cost the
 * whole feature.
 *
 * A function rather than a constant so the call sites read as questions, and so
 * this reasoning has one home if the real contract ever arrives.
 */
export function supportsExistingAgentDelivery(): boolean {
  return true;
}

export function canAssignToAgent(status: string): boolean {
  // A busy agent may accept another prompt, but Herdr cannot correlate its
  // completion with a specific turn. Start new assignments at an idle prompt.
  return status === 'idle' || status === 'done';
}

export function collaborationPrompt(prompt: string, context: string): string {
  return context.trim()
    ? `${prompt.trim()}\n\n---\nContext shared from another terminal (reference material):\n${context.slice(-6000)}`
    : prompt.trim();
}

export function parseCollaborationTasks(value: string | null): CollaborationTask[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((task): task is CollaborationTask =>
        Boolean(
          task &&
          typeof task === 'object' &&
          ['id', 'serverId', 'sessionId', 'sourcePaneId', 'paneId', 'agentName', 'prompt'].every(
            (key) => typeof task[key] === 'string'
          ) &&
          typeof task.createdAt === 'number' &&
          Number.isFinite(task.createdAt) &&
          (task.agentInstanceId === undefined ||
            (typeof task.agentInstanceId === 'string' && task.agentInstanceId.length > 0)) &&
          (task.reviewed === undefined || typeof task.reviewed === 'boolean') &&
          (task.superseded === undefined || typeof task.superseded === 'boolean')
        )
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}
