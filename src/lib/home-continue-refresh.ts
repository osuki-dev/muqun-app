import { hasRealSessionTitle, parseAgentSessionList } from './agent-protocol';
import { normalizeGatewayEntities } from './gateway-entities';
import {
  gatewayAgentSessions,
  HOME_CONTINUE_GATEWAY_SESSION_LIMIT,
  type GatewayAgentSessionsSnapshot,
} from './home-continue';
import type { HomeRecentEntry, HomeTarget, HomeSessionObservation } from './home-recents';
import { mirroredServerPanes, type ServerAgentsSnapshot } from './server-agents';

/** Bound reads and publication to one explicit Home selection, never the live connection. */
export async function refreshHomeContinue({
  serverId,
  sessionId,
  entries,
  read,
  isCurrent,
  recordPanes,
  observe,
  updateTitle,
  repairAgent,
  recordAgentSessions,
  agentSessionLimit = HOME_CONTINUE_GATEWAY_SESSION_LIMIT,
}: {
  serverId: string;
  sessionId: string;
  entries: readonly HomeRecentEntry[];
  read: (path: string) => Promise<unknown>;
  isCurrent: () => boolean;
  recordPanes: (snapshot: ServerAgentsSnapshot) => Promise<void>;
  observe: (target: HomeTarget, observation: HomeSessionObservation) => Promise<void>;
  updateTitle: (target: HomeTarget, title: string) => Promise<void>;
  /** Writes the gateway's agent onto a remembered session that names another. */
  repairAgent?: (target: HomeTarget, agentId: string) => Promise<void>;
  /**
   * Present for the selected gateway only: its merged agent-session listing
   * goes here, so Continue shows sessions this device never opened.
   */
  recordAgentSessions?: (snapshot: GatewayAgentSessionsSnapshot) => void;
  agentSessionLimit?: number;
}) {
  const repair = async (target: HomeTarget, agentId: string) => {
    if (repairAgent && target.kind === 'agent-session' && target.agentId !== agentId)
      await repairAgent(target, agentId);
  };
  const scopes = new Map<string, { sessionId: string; directory: string }>();
  for (const { target } of entries) {
    if (target.kind === 'agent-session' && target.serverId === serverId) {
      scopes.set(JSON.stringify([target.sessionId, target.directory]), target);
    }
  }
  return Promise.allSettled([
    (async () => {
      const base = `/api/sessions/${encodeURIComponent(sessionId)}`;
      const [panes, agents] = await Promise.all([read(`${base}/panes`), read(`${base}/agents`)]);
      if (!isCurrent()) return;
      await recordPanes({
        serverId,
        sessionId,
        checkedAtMs: Date.now(),
        agents: mirroredServerPanes(
          normalizeGatewayEntities(panes, ['panes', 'items']),
          normalizeGatewayEntities(agents, ['agents', 'items'])
        ),
      });
    })(),
    ...[...scopes.values()].map(async (scope) => {
      const query = new URLSearchParams({
        roots: 'true',
        directory: scope.directory,
        limit: '50',
        order: 'desc',
      });
      const response = await read(
        `/api/sessions/${encodeURIComponent(scope.sessionId)}/agent-sessions?${query}`
      );
      if (!isCurrent()) return;
      const data =
        response && typeof response === 'object' && 'data' in response ? response.data : response;
      const sessions = new Map(parseAgentSessionList(data).map((info) => [info.asid, info]));
      const observedAtMs = Date.now();
      for (const { target } of entries) {
        if (!isCurrent()) return;
        if (
          target.kind !== 'agent-session' ||
          target.serverId !== serverId ||
          target.sessionId !== scope.sessionId ||
          target.directory !== scope.directory
        )
          continue;
        const info = sessions.get(target.asid);
        if (!info || info.parent_id || info.deleted) continue;
        if (hasRealSessionTitle(info)) await updateTitle(target, info.title);
        if (isCurrent()) await observe(target, { status: info.status, observedAtMs });
        if (isCurrent()) await repair(target, info.agent_id);
      }
    }),
    ...(recordAgentSessions
      ? [
          (async () => {
            // No `agent_id`: a multi-agent gateway merges every agent's list
            // and tags each row with its owner.
            const query = new URLSearchParams({
              roots: 'true',
              limit: String(agentSessionLimit),
              order: 'desc',
            });
            const response = await read(`/api/agent-sessions?${query}`);
            if (!isCurrent()) return;
            const data =
              response && typeof response === 'object' && 'data' in response
                ? response.data
                : response;
            const sessions = gatewayAgentSessions(parseAgentSessionList(data), agentSessionLimit);
            recordAgentSessions({ serverId, sessionId, observedAtMs: Date.now(), sessions });
            const owners = new Map(sessions.map((session) => [session.asid, session.agentId]));
            for (const { target } of entries) {
              if (!isCurrent()) return;
              if (target.kind !== 'agent-session' || target.serverId !== serverId) continue;
              const agentId = owners.get(target.asid);
              if (agentId) await repair(target, agentId);
            }
          })(),
        ]
      : []),
  ]);
}

/** Refresh independent gateways with bounded concurrency; one failure keeps other rows fresh. */
export async function refreshHomeGateways<T extends { serverId: string }>({
  records,
  selectedServerId,
  isCurrent,
  refresh,
}: {
  records: readonly T[];
  selectedServerId?: string;
  isCurrent: () => boolean;
  refresh: (record: T) => Promise<unknown>;
}): Promise<void> {
  const queue = [...new Map(records.map((record) => [record.serverId, record])).values()];
  queue.sort(
    (a, b) => Number(b.serverId === selectedServerId) - Number(a.serverId === selectedServerId)
  );
  const worker = async (): Promise<void> => {
    if (!isCurrent()) return;
    const record = queue.shift();
    if (!record) return;
    try {
      await refresh(record);
    } catch {
      // Keep the last observation and its original timestamp on failed reads.
    }
    await worker();
  };
  await Promise.all([worker(), worker()]);
}
