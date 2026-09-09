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
  command?: { name: string; instructions?: string; description?: string };
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

export function collaborationAvailability(health: HealthResponse, sessionId: string, kind: string) {
  if (kind !== 'herdr') return 'backend' as const;
  if (!health.capabilities?.includes('agent_collaboration')) return 'gateway' as const;
  const backend =
    health.backends?.find((item) => item.sessionId === sessionId) ??
    (health.backend?.sessionId === sessionId ? health.backend : undefined);
  if (!backend?.connected || backend.kind !== 'herdr' || !backend.version)
    return 'unavailable' as const;
  const version = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(backend.version);
  if (!version) return 'herdr' as const;
  return Number(version[1]) > 0 || Number(version[2]) >= 9
    ? ('ready' as const)
    : ('herdr' as const);
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
