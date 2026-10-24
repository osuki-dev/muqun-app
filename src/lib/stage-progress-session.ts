import {
  goneSessionKey,
  type GatewayAgentSessionsSnapshot,
  type HomeContinueEntry,
} from './home-continue';
import { SERVER_AGENTS_STALE_AFTER_MS, type ServerAgentsSnapshot } from './server-agents';
import type { StageProgress } from './stage-overlay';

/** Resolve a subtitle to a conversation using opaque IDs or an explicit gateway association. */
export function stageProgressSession({
  line,
  serverId,
  entries,
  sessions,
  sessionsSeenAtMs,
  panes,
  nowMs,
}: {
  line: StageProgress;
  serverId: string;
  entries: readonly HomeContinueEntry[];
  sessions?: GatewayAgentSessionsSnapshot;
  sessionsSeenAtMs?: number;
  panes?: ServerAgentsSnapshot;
  nowMs: number;
}): HomeContinueEntry | null {
  const isSession = line.key.startsWith('session:');
  const isPane = line.key.startsWith('pane:');
  if (!isSession && !isPane) return null;
  const id = line.key.slice(line.key.indexOf(':') + 1);
  const listed = sessions?.serverId === serverId ? sessions : undefined;
  const observedAtMs = Math.max(
    listed?.observedAtMs ?? 0,
    sessionsSeenAtMs ?? listed?.observedAtMs ?? 0
  );
  let asid = isSession ? (line.asid ?? id) : undefined;
  let agentId = line.agentId;
  if (isPane) {
    const terminal = line.terminal;
    const pane = panes?.agents.find((candidate) => candidate.paneId === id);
    if (
      !terminal ||
      !listed ||
      !pane ||
      panes?.serverId !== serverId ||
      panes.sessionId !== terminal.sessionId ||
      nowMs - panes.checkedAtMs > SERVER_AGENTS_STALE_AFTER_MS ||
      nowMs - observedAtMs > SERVER_AGENTS_STALE_AFTER_MS ||
      (terminal.instanceId && pane.instanceId !== terminal.instanceId) ||
      (terminal.shellPid && pane.shellPid !== terminal.shellPid)
    )
      return null;
    const matches = listed.sessions.filter(
      (session) =>
        session.terminal?.sessionId === terminal.sessionId &&
        session.terminal.paneId === id &&
        (!session.terminal.instanceId || session.terminal.instanceId === pane.instanceId) &&
        (!agentId || session.agentId === agentId)
    );
    // Several histories can mention the same terminal. Never choose by title or recency.
    if (matches.length !== 1) return null;
    asid = matches[0]!.asid;
    agentId = matches[0]!.agentId;
  }
  const reported = listed?.sessions.filter(
    (session) => session.asid === asid && (!agentId || session.agentId === agentId)
  );
  // A followed conversation already supplied its routing identity. Listing churn
  // must not redirect its subtitle to another workspace or to a terminal.
  if (isSession && line.asid && line.sessionId && line.agentId) {
    const session = reported?.length === 1 ? reported[0] : undefined;
    return {
      key: goneSessionKey(serverId, line.asid, line.agentId),
      title: session?.title ?? line.asid,
      atMs: line.atMs,
      destination: {
        type: 'agent-session',
        target: {
          kind: 'agent-session',
          serverId,
          sessionId: line.sessionId,
          asid: line.asid,
          ...(line.agentId ? { agentId: line.agentId } : {}),
          directory: session?.directory ?? '',
        },
      },
    };
  }
  // A current explicit report outranks a recent's old routing workspace.
  const currentSessionId =
    listed && reported?.length === 1 && nowMs - observedAtMs <= SERVER_AGENTS_STALE_AFTER_MS
      ? listed.sessionId
      : undefined;
  const matches = entries.filter(({ destination }) => {
    if (destination.type === 'pane' || destination.target.kind !== 'agent-session') return false;
    const target = destination.target;
    return (
      target.serverId === serverId &&
      target.asid === asid &&
      (!currentSessionId || target.sessionId === currentSessionId) &&
      (!agentId || target.agentId === agentId)
    );
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return null;
  if (!listed || reported?.length !== 1) return null;
  const session = reported[0]!;
  return {
    key: goneSessionKey(serverId, session.asid, session.agentId),
    title: session.title,
    atMs: session.updatedMs,
    destination: {
      type: 'agent-session',
      target: {
        kind: 'agent-session',
        serverId,
        sessionId: listed.sessionId,
        asid: session.asid,
        agentId: session.agentId,
        directory: session.directory,
      },
    },
  };
}
