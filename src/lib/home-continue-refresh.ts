import { hasRealSessionTitle, parseAgentSessionList } from './agent-protocol';
import { normalizeGatewayEntities } from './gateway-entities';
import {
  gatewayAgentSessions,
  HOME_CONTINUE_GATEWAY_SESSION_LIMIT,
  type GatewayAgentSessionsSnapshot,
} from './home-continue';
import type { HomeRecentEntry, HomeTarget, HomeSessionObservation } from './home-recents';
import { mirroredServerPanes, type ServerAgentsSnapshot } from './server-agents';
import { endpointIsAbsent, sessionSnapshotFromAnswer } from './session-snapshot';

/**
 * How often Home re-reads Continue, and how often an open terminal re-stamps
 * its visit so it keeps ranking as recent while the user stays on it.
 */
export { HOME_CONTINUE_REFRESH_MS } from './home-refresh-schedule';

/**
 * How many of a computer's newest root sessions one Continue read covers. The
 * gateway's own default page; a remembered session older than this keeps the
 * status it was last seen with.
 */
const AGENT_SESSION_LIST_LIMIT = 50;

/**
 * One computer's Continue refresh: its panes and agents (one batched read when
 * the gateway serves agents in `/snapshot`, otherwise `/panes` and `/agents`),
 * and -- only when there is something to match it against -- one merged
 * `/api/agent-sessions` list, from which every remembered session's title,
 * status and agent are read. One list per computer, never one per folder.
 */
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
  servesSnapshot = false,
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
  /** The gateway announces `session_snapshot`: its `/snapshot` carries the real agents. */
  servesSnapshot?: boolean;
  agentSessionLimit?: number;
}) {
  const repair = async (target: HomeTarget, agentId: string) => {
    if (repairAgent && target.kind === 'agent-session' && target.agentId !== agentId)
      await repairAgent(target, agentId);
  };
  const remembered = entries.filter(
    ({ target }) => target.kind === 'agent-session' && target.serverId === serverId
  );
  const base = `/api/sessions/${encodeURIComponent(sessionId)}`;
  const readPanes = async () => {
    if (servesSnapshot) {
      try {
        const snapshot = sessionSnapshotFromAnswer(await read(`${base}/snapshot`), true);
        if (snapshot.agents) return { panes: snapshot.panes, agents: snapshot.agents };
      } catch (error) {
        if (!endpointIsAbsent(error)) throw error;
      }
    }
    const [panes, agents] = await Promise.all([read(`${base}/panes`), read(`${base}/agents`)]);
    return {
      panes: normalizeGatewayEntities(panes, ['panes', 'items']),
      agents: normalizeGatewayEntities(agents, ['agents', 'items']),
    };
  };
  return Promise.allSettled([
    (async () => {
      const { panes, agents } = await readPanes();
      if (!isCurrent()) return;
      await recordPanes({
        serverId,
        sessionId,
        checkedAtMs: Date.now(),
        agents: mirroredServerPanes(panes, agents),
      });
    })(),
    ...(remembered.length > 0 || recordAgentSessions
      ? [
          (async () => {
            // No `agent_id` and no `directory`: a multi-agent gateway merges
            // every agent's list and tags each row with its owner and folder.
            const query = new URLSearchParams({
              roots: 'true',
              limit: String(Math.max(AGENT_SESSION_LIST_LIMIT, agentSessionLimit)),
              order: 'desc',
            });
            const list = listedSessions(await read(`/api/agent-sessions?${query}`));
            if (!isCurrent()) return;
            const observedAtMs = Date.now();
            if (recordAgentSessions) {
              const sessions = gatewayAgentSessions(list, agentSessionLimit);
              recordAgentSessions({ serverId, sessionId, observedAtMs, sessions });
            }
            const byAsid = new Map(list.map((info) => [info.asid, info]));
            // A remembered session the merged list did not carry -- older than
            // its newest page, or behind an adapter that scopes an unscoped
            // list to one folder -- is read in its own folder, as it used to
            // be: one read per folder that has such a session, never more than
            // the per-folder reads this replaced.
            const unlisted = new Map<string, { sessionId: string; directory: string }>();
            for (const { target } of remembered) {
              if (target.kind === 'agent-session' && !byAsid.has(target.asid))
                unlisted.set(JSON.stringify([target.sessionId, target.directory]), target);
            }
            await Promise.all(
              [...unlisted.values()].map(async (folder) => {
                const scoped = new URLSearchParams({
                  roots: 'true',
                  directory: folder.directory,
                  limit: String(AGENT_SESSION_LIST_LIMIT),
                  order: 'desc',
                });
                const found = await read(
                  `/api/sessions/${encodeURIComponent(folder.sessionId)}/agent-sessions?${scoped}`
                ).then(listedSessions, () => []);
                for (const info of found) if (!byAsid.has(info.asid)) byAsid.set(info.asid, info);
              })
            );
            for (const { target } of remembered) {
              if (!isCurrent()) return;
              if (target.kind !== 'agent-session') continue;
              const info = byAsid.get(target.asid);
              if (!info || info.parent_id || info.deleted) continue;
              if (hasRealSessionTitle(info)) await updateTitle(target, info.title);
              if (isCurrent()) await observe(target, { status: info.status, observedAtMs });
              if (isCurrent() && info.agent_id) await repair(target, info.agent_id);
            }
          })(),
        ]
      : []),
  ]);
}

function listedSessions(response: unknown) {
  return parseAgentSessionList(
    response && typeof response === 'object' && 'data' in response ? response.data : response
  );
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
