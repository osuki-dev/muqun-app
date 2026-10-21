/**
 * What each computer's core on the Stage shows, read from the same Home
 * state Classic and Editorial read: the launch controller's computers, their
 * connection statuses, the mirrored agents, the attention observations, the
 * task ledgers and the Recent entries. A presentation adapter only -- it
 * reshapes nothing it is given and fetches nothing.
 *
 * The core and its agent orbs say what the computer is doing now and
 * whether it needs the reader; where to jump back in is the session strip's
 * job, so no session titles appear here.
 */
import type { HomeAttentionSnapshot } from './home-attention';
import { homeContinueServerId, type HomeContinueEntry } from './home-continue';
import type { AgentStatus } from './herdr-entity';
import { isServerAgentsStale, type ServerAgent, type ServerAgentsIndex } from './server-agents';
import { reachabilityOfStatus, type ConnectionStatus } from './server-reachability';
import type { ServerTasksIndex } from './server-tasks-state';
import type { TaskView } from './task-ledger';

export type StagePanelTone = 'online' | 'offline' | 'unknown' | 'warning';

/** What an agent's orb says: it waits on the reader, it runs, or neither. */
export type StageAgentMark = 'working' | 'needs-you' | 'idle';

export type StageAgentLine = {
  /** The mirror's row id: stable while the agent lives, unique on its computer. */
  key: string;
  name: string;
  mark: StageAgentMark;
  status: AgentStatus;
  /**
   * What it is doing, as the gateway said it: its open task's progress line
   * or title, else its pane title. Absent when nothing says, and never set
   * for an idle agent: an old task line is not what it is doing now.
   */
  activity?: string;
  /** The pane it runs in, so a tap on its orb lands there; absent when unknown. */
  paneId?: string;
};

export type StagePanel = {
  serverId: string;
  label: string;
  connection: ConnectionStatus;
  tone: StagePanelTone;
  /** An agent on it is running right now (fresh mirror only). */
  working: boolean;
  /** A request or a question is waiting on the reader. */
  attention: boolean;
  /** Agents running now (fresh mirror only, never on an offline computer). */
  workingCount: number;
  /** Agents or sessions waiting on the reader. */
  needsYouCount: number;
  /** Recent sessions on this computer, as Home's Recent list holds them. */
  sessionCount: number;
  /** When the app last confirmed its agents with it, for "last seen". */
  lastSeenMs?: number;
  /**
   * Its agents, waiting on the reader first, then running, then the rest,
   * each in mirror order; none on an offline computer.
   */
  agents: StageAgentLine[];
};

export function stagePanelTone(connection: ConnectionStatus): StagePanelTone {
  if (connection === 'repair' || connection === 'unauthorized' || connection === 'reconnecting')
    return 'warning';
  const reachability = reachabilityOfStatus(connection);
  return reachability === 'live' ? 'online' : reachability === 'offline' ? 'offline' : 'unknown';
}

export function stagePanels({
  servers,
  connectionStatuses,
  agentsByServer,
  attention,
  tasks = {},
  recentEntries,
  nowMs,
}: {
  servers: readonly { serverId: string; label: string }[];
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  agentsByServer: ServerAgentsIndex;
  attention: Readonly<Record<string, HomeAttentionSnapshot>>;
  /** The task ledgers Home holds, for what a working agent is doing. */
  tasks?: ServerTasksIndex;
  recentEntries: readonly HomeContinueEntry[];
  nowMs: number;
}): StagePanel[] {
  const sessions = new Map<string, number>();
  for (const entry of recentEntries) {
    const serverId = homeContinueServerId(entry);
    if (serverId) sessions.set(serverId, (sessions.get(serverId) ?? 0) + 1);
  }
  const requests = new Map<string, number>();
  for (const snapshot of Object.values(attention)) {
    if (snapshot.requestIds.length === 0) continue;
    const serverId = snapshot.target.serverId;
    requests.set(serverId, (requests.get(serverId) ?? 0) + 1);
  }
  return servers.map((server) => {
    const connection = connectionStatuses[server.serverId] ?? 'unknown';
    const tone = stagePanelTone(connection);
    const offline = tone === 'offline';
    const snapshot = agentsByServer[server.serverId];
    // An old mirror says what was running then, not now: no pulse from it.
    const fresh = snapshot && !isServerAgentsStale(snapshot, nowMs) ? snapshot.agents : [];
    const lines = offline
      ? []
      : agentLines(
          fresh.filter((agent) => agent.hasAgent),
          tasks[server.serverId]?.tasks ?? []
        );
    const workingCount = lines.filter((line) => line.mark === 'working').length;
    // A native request and its agent's blocked pane are usually one wait seen
    // twice, so the larger count, never the sum.
    const needsYouCount = Math.max(
      requests.get(server.serverId) ?? 0,
      fresh.filter((agent) => agent.hasAgent && needsYou(agent)).length
    );
    return {
      serverId: server.serverId,
      label: server.label,
      connection,
      tone,
      working: workingCount > 0,
      attention: needsYouCount > 0,
      workingCount,
      needsYouCount,
      sessionCount: sessions.get(server.serverId) ?? 0,
      ...(snapshot ? { lastSeenMs: snapshot.checkedAtMs } : {}),
      agents: lines,
    };
  });
}

function needsYou(agent: ServerAgent): boolean {
  return agent.status === 'blocked' || agent.pendingUserInput === true;
}

const MARK_ORDER: Record<StageAgentMark, number> = { 'needs-you': 0, working: 1, idle: 2 };

/** Waiting on the reader first, then running, then the rest, each in mirror order. */
function agentLines(agents: readonly ServerAgent[], tasks: readonly TaskView[]): StageAgentLine[] {
  return agents
    .map((agent): StageAgentLine => {
      const mark: StageAgentMark = needsYou(agent)
        ? 'needs-you'
        : agent.status === 'working'
          ? 'working'
          : 'idle';
      const name = agent.agentLabel ?? agent.name;
      const activity = mark === 'idle' ? undefined : activityOf(agent, tasks);
      return {
        key: agent.id,
        name,
        mark,
        status: agent.status,
        ...(activity ? { activity } : {}),
        ...(agent.paneId ? { paneId: agent.paneId } : {}),
      };
    })
    .map((line, index) => ({ line, index }))
    .sort((a, b) => MARK_ORDER[a.line.mark] - MARK_ORDER[b.line.mark] || a.index - b.index)
    .map(({ line }) => line);
}

/**
 * The newest open task running in the agent's pane says what it is doing;
 * a pane id is reused across shells, so a differing shell pid rules a task
 * out. Without one, the pane's own title says it when it is more than the
 * agent's name.
 */
function activityOf(agent: ServerAgent, tasks: readonly TaskView[]): string | undefined {
  if (agent.paneId) {
    let newest: TaskView | undefined;
    for (const task of tasks) {
      const binding = task.binding;
      if (task.state !== 'working' && task.state !== 'waiting') continue;
      if (binding.kind !== 'pane' || binding.paneId !== agent.paneId) continue;
      if (binding.shellPid !== undefined && agent.shellPid !== undefined)
        if (binding.shellPid !== agent.shellPid) continue;
      if (!newest || task.updatedMs > newest.updatedMs) newest = task;
    }
    const said = [newest?.progress, newest?.title, newest?.label]
      .map((text) => text?.trim())
      .find((text) => text);
    if (said) return withoutName(said, agent.agentLabel);
  }
  const title = agent.agentLabel ? withoutName(agent.name.trim(), agent.agentLabel) : undefined;
  return title && title !== agent.agentLabel ? title : undefined;
}

/**
 * The line already starts with the agent's name, so an activity that repeats
 * it ("claude · review" for claude) keeps only what follows.
 */
function withoutName(text: string, name: string | undefined): string | undefined {
  if (!name) return text;
  for (const separator of [' · ', ' - ', ': ']) {
    if (text.toLowerCase().startsWith((name + separator).toLowerCase())) {
      const rest = text.slice(name.length + separator.length).trim();
      return rest || undefined;
    }
  }
  return text;
}

/** Where the selected computer stands among the cores; 0 when it is not there. */
export function stageSelectedIndex(
  panels: readonly { serverId: string }[],
  serverId: string | undefined
): number {
  const index = serverId ? panels.findIndex((panel) => panel.serverId === serverId) : -1;
  return index < 0 ? 0 : index;
}
