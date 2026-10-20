/**
 * What each computer's glass pane on the Stage says, read from the same Home
 * state Classic and Editorial read: the launch controller's computers, their
 * connection statuses, the mirrored agents, the attention observations and
 * the Recent entries. A presentation adapter only -- it reshapes nothing it
 * is given and fetches nothing.
 */
import type { HomeAttentionSnapshot } from './home-attention';
import { homeContinueServerId, type HomeContinueEntry } from './home-continue';
import type { AgentStatus } from './herdr-entity';
import { isServerAgentsStale, type ServerAgentsIndex } from './server-agents';
import { reachabilityOfStatus, type ConnectionStatus } from './server-reachability';

export type StagePanelTone = 'online' | 'offline' | 'unknown' | 'warning';

export type StagePanel = {
  serverId: string;
  label: string;
  connection: ConnectionStatus;
  tone: StagePanelTone;
  /** An agent on it is running right now (fresh mirror only). */
  working: boolean;
  /** A request or a question is waiting on the reader. */
  attention: boolean;
  /** Recent sessions on this computer, as Home's Recent list holds them. */
  sessionCount: number;
  /** When the app last confirmed its agents with it, for "last seen". */
  lastSeenMs?: number;
  /**
   * What its screen shows: the agents the mirror last saw running on it, then
   * its latest session titles. Terminal output is not mirrored on Home, so the
   * face never claims to be live text.
   */
  face: { agents: { name: string; status: AgentStatus }[]; sessions: string[] };
};

/** Lines a screen has room for. */
export const STAGE_FACE_LINES = 4;

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
  recentEntries,
  nowMs,
}: {
  servers: readonly { serverId: string; label: string }[];
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  agentsByServer: ServerAgentsIndex;
  attention: Readonly<Record<string, HomeAttentionSnapshot>>;
  recentEntries: readonly HomeContinueEntry[];
  nowMs: number;
}): StagePanel[] {
  const sessions = new Map<string, number>();
  const titles = new Map<string, string[]>();
  for (const entry of recentEntries) {
    const serverId = homeContinueServerId(entry);
    if (!serverId) continue;
    sessions.set(serverId, (sessions.get(serverId) ?? 0) + 1);
    const list = titles.get(serverId) ?? [];
    if (list.length < STAGE_FACE_LINES) list.push(entry.title);
    titles.set(serverId, list);
  }
  const waiting = new Set<string>();
  for (const snapshot of Object.values(attention))
    if (snapshot.requestIds.length > 0) waiting.add(snapshot.target.serverId);
  return servers.map((server) => {
    const connection = connectionStatuses[server.serverId] ?? 'unknown';
    const tone = stagePanelTone(connection);
    const snapshot = agentsByServer[server.serverId];
    // An old mirror says what was running then, not now: no pulse from it.
    const agents = snapshot && !isServerAgentsStale(snapshot, nowMs) ? snapshot.agents : [];
    return {
      serverId: server.serverId,
      label: server.label,
      connection,
      tone,
      working: tone !== 'offline' && agents.some((agent) => agent.status === 'working'),
      attention:
        waiting.has(server.serverId) ||
        agents.some((agent) => agent.status === 'blocked' || agent.pendingUserInput === true),
      sessionCount: sessions.get(server.serverId) ?? 0,
      ...(snapshot ? { lastSeenMs: snapshot.checkedAtMs } : {}),
      face: faceOf(agents, titles.get(server.serverId) ?? []),
    };
  });
}

function faceOf(
  agents: readonly { name: string; agentLabel?: string; status: AgentStatus; hasAgent: boolean }[],
  titles: readonly string[]
): StagePanel['face'] {
  const running = agents
    .filter((agent) => agent.hasAgent)
    // Working first: what is happening now heads the screen.
    .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working'))
    .slice(0, 2)
    .map((agent) => ({ name: agent.agentLabel ?? agent.name, status: agent.status }));
  return { agents: running, sessions: titles.slice(0, STAGE_FACE_LINES - running.length) };
}

/** Where the selected computer stands among the panes; 0 when it is not there. */
export function stageSelectedIndex(
  panels: readonly { serverId: string }[],
  serverId: string | undefined
): number {
  const index = serverId ? panels.findIndex((panel) => panel.serverId === serverId) : -1;
  return index < 0 ? 0 : index;
}
