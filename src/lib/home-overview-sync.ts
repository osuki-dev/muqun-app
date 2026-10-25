import { HOME_AGENT_SESSION_ID } from './home-composer';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useHomeSummary } from '@/stores/home-summary';
import { useServerAgents } from '@/stores/server-agents';
import { useServerSession } from '@/stores/server-session';
import { hasRealSessionTitle } from './agent-protocol';
import { HOME_CONTINUE_GATEWAY_SESSION_LIMIT } from './home-continue';

/** A dead collector or missing source immediately restores direct discovery. */
export function freshHomeOverview(serverId: string, nowMs = Date.now()) {
  const { live, overviews } = useHomeSummary.getState();
  const summary = overviews[serverId];
  return live[serverId] && summary?.overview && nowMs - (summary.overviewAtMs ?? 0) < 75_000
    ? summary.overview
    : undefined;
}

export function publishHomeOverview(serverId: string) {
  const overview = freshHomeOverview(serverId);
  if (!overview) return false;
  const preferred = useServerSession.getState().byServer[serverId];
  const workspace =
    overview.workspaces.find((row) => row.sessionId === preferred) ??
    (preferred && overview.unavailableWorkspaces?.includes(preferred)
      ? undefined
      : overview.workspaces[0]);
  // Re-reading the cache is not a new observation; do not wake selectors or
  // rewrite recent-session timestamps on every Home refresh tick.
  const observedAtMs = useHomeSummary.getState().overviews[serverId]?.overviewAtMs;
  if (!observedAtMs) return false;
  if (workspace || !overview.unavailableWorkspaces?.length)
    void useServerAgents.getState().record({
      serverId,
      sessionId: workspace?.sessionId ?? preferred ?? HOME_AGENT_SESSION_ID,
      checkedAtMs: observedAtMs,
      agents: workspace?.agents ?? [],
    });
  useHomeAgentSessions.getState().record({
    serverId,
    sessionId: workspace?.sessionId ?? preferred ?? HOME_AGENT_SESSION_ID,
    observedAtMs,
    sessions: [
      ...overview.sessions,
      ...(useHomeAgentSessions.getState().byServer[serverId]?.sessions ?? [])
        .filter((row) => overview.unavailableProviders?.includes(row.agentId))
        .map((row) => (row.status === 'unknown' ? row : { ...row, status: 'unknown' as const })),
    ].slice(0, HOME_CONTINUE_GATEWAY_SESSION_LIMIT),
  });
  const recent = useHomeRecentsStore.getState();
  for (const entry of recent.entries) {
    const { target } = entry;
    if (target.kind !== 'agent-session' || target.serverId !== serverId) continue;
    if (target.agentId && overview.unavailableProviders?.includes(target.agentId)) {
      void recent.observeSession(target, { status: 'unknown', observedAtMs });
      continue;
    }
    const matches = overview.sessions.filter(
      (row) => row.asid === target.asid && (!target.agentId || row.agentId === target.agentId)
    );
    if (matches.length !== 1) continue;
    const session = matches[0]!;
    if (hasRealSessionTitle({ title: session.title }) && entry.title !== session.title)
      void recent.updateTitle(target, session.title);
    void recent.observeSession(target, { status: session.status, observedAtMs });
    if (target.agentId !== session.agentId) void recent.repairAgent(target, session.agentId);
  }
  return true;
}
