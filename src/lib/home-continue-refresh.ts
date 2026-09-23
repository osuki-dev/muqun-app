import { hasRealSessionTitle, parseAgentSessionList } from './agent-protocol';
import { normalizeGatewayEntities } from './gateway-entities';
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
}: {
  serverId: string;
  sessionId: string;
  entries: readonly HomeRecentEntry[];
  read: (path: string) => Promise<unknown>;
  isCurrent: () => boolean;
  recordPanes: (snapshot: ServerAgentsSnapshot) => Promise<void>;
  observe: (target: HomeTarget, observation: HomeSessionObservation) => Promise<void>;
  updateTitle: (target: HomeTarget, title: string) => Promise<void>;
}) {
  const scopes = new Map<string, { sessionId: string; directory: string }>();
  for (const { target } of entries) {
    if (target.kind === 'opencode-session' && target.serverId === serverId) {
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
          target.kind !== 'opencode-session' ||
          target.serverId !== serverId ||
          target.sessionId !== scope.sessionId ||
          target.directory !== scope.directory
        )
          continue;
        const info = sessions.get(target.asid);
        if (!info || info.parent_id || info.deleted) continue;
        if (hasRealSessionTitle(info)) await updateTitle(target, info.title);
        if (isCurrent()) await observe(target, { status: info.status, observedAtMs });
      }
    }),
  ]);
}
