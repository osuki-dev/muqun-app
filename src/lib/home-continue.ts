import { hasRealSessionTitle, type AgentSessionInfo } from './agent-protocol';
import type { HomeCommand } from './home-commands';
import {
  homeTargetAgentId,
  homeTargetKey,
  type HomeRecentEntry,
  type HomeSessionObservation,
  type HomeTarget,
} from './home-recents';
import {
  homeServerModel,
  type HomeServerModel,
  type HomeServerPaneMode,
} from './home-server-model';
import {
  MAX_SERVER_AGENTS,
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgent,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from './server-agents';
import type { ServerReachability } from './server-reachability';

type HomeContinueAge = NonNullable<HomeServerModel['age']>;

/**
 * Where a newer confirmation of an observation lands without the Continue list
 * being rebuilt: a pass that only says "still the same" moves a timestamp in
 * one of these, and only the row that shows the age reads it.
 */
export type HomeContinueSeen = {
  /** The computer whose pane mirror (`server-agents`) confirmed it. */
  panesOf?: string;
  /** The remembered recent (`home-recents` `seenAtMs`). */
  recentKey?: string;
  /** The computer whose agent-session list (`home-agent-sessions`) confirmed it. */
  listedBy?: string;
};

/**
 * The gateway's last word on a row, as of when the list was built. How old it
 * is -- and so whether its status may still be shown -- is the row's to work
 * out against the clock: see {@link homeContinueObservationNow}.
 */
export type HomeContinueObservation =
  | {
      kind: 'gateway-agent';
      status?: ServerAgent['status'];
      observedAtMs: number;
      seen: HomeContinueSeen;
    }
  | {
      kind: 'agent-session';
      status?: HomeSessionObservation['status'];
      observedAtMs: number;
      seen: HomeContinueSeen;
    };

/** An observation as the row shows it: its age, and its status only while current. */
export type HomeContinueObservationView =
  | { kind: 'gateway-agent'; status?: ServerAgent['status']; age: HomeContinueAge; stale: boolean }
  | {
      kind: 'agent-session';
      status?: HomeSessionObservation['status'];
      age: HomeContinueAge;
      stale: boolean;
    };

/**
 * What a row says about its observation now. `confirmedAtMs` is the newest
 * "still the same" from the row's {@link HomeContinueSeen} sources.
 */
export function homeContinueObservationNow(
  observation: HomeContinueObservation,
  confirmedAtMs: number,
  nowMs: number
): HomeContinueObservationView {
  const atMs = Math.max(observation.observedAtMs, confirmedAtMs);
  const stale = nowMs - atMs > SERVER_AGENTS_STALE_AFTER_MS;
  const age = observationAgeParts(atMs, nowMs);
  if (observation.kind === 'gateway-agent') {
    return {
      kind: observation.kind,
      age,
      stale,
      ...(!stale && observation.status ? { status: observation.status } : {}),
    };
  }
  return {
    kind: observation.kind,
    age,
    stale,
    ...(!stale && observation.status ? { status: observation.status } : {}),
  };
}

export type HomeContinueEntry = {
  key: string;
  title: string;
  atMs: number;
  /** Structured gateway agent identity, if the pane snapshot reported one. */
  agentLabel?: string;
  /** Latest gateway observation; this is never inferred from visit history. */
  observation?: HomeContinueObservation;
  destination:
    | { type: 'pane'; serverId: string; paneId?: string; cwd?: string }
    | { type: 'recent'; target: HomeTarget }
    /** An agent session the gateway listed that this device has no recent for. */
    | { type: 'agent-session'; target: HomeAgentSessionTarget };
};

type HomeAgentSessionTarget = Extract<HomeTarget, { kind: 'agent-session' }>;

/** The identity a gone agent session is remembered by: one gateway's one session. */
export function goneSessionKey(serverId: string, asid: string): string {
  return JSON.stringify([serverId, asid]);
}

/** How many of the gateway's most recently updated agent sessions Continue merges in. */
export const HOME_CONTINUE_GATEWAY_SESSION_LIMIT = 8;

/** One agent session as the gateway reported it, trimmed to what Continue shows. */
export type GatewayAgentSession = {
  asid: string;
  agentId: string;
  title: string;
  directory: string;
  status: HomeSessionObservation['status'];
  updatedMs: number;
};

/** The chosen gateway's merged `GET /api/agent-sessions`, as last read. */
export type GatewayAgentSessionsSnapshot = {
  serverId: string;
  /** The Herdr routing session the rows open through. */
  sessionId: string;
  observedAtMs: number;
  sessions: readonly GatewayAgentSession[];
};

/**
 * The `limit` most recently updated root sessions of a merged listing, newest
 * first. Subagent and deleted sessions are not something to continue.
 */
export function gatewayAgentSessions(
  list: readonly AgentSessionInfo[],
  limit = HOME_CONTINUE_GATEWAY_SESSION_LIMIT
): GatewayAgentSession[] {
  return list
    .filter((info) => info.asid && !info.parent_id && !info.deleted)
    .sort((a, b) => b.updated_ms - a.updated_ms)
    .slice(0, Math.max(0, limit))
    .map((info) => ({
      asid: info.asid,
      agentId: info.agent_id,
      title: info.title,
      directory: info.directory ?? '',
      status: info.status,
      updatedMs: info.updated_ms,
    }));
}

/** The target a Continue row stands for, when it is not a live pane. */
export function homeContinueTarget(
  destination: HomeContinueEntry['destination']
): HomeTarget | undefined {
  return destination.type === 'pane' ? undefined : destination.target;
}

/** What a row's caption names: an agent's session, a terminal, or an SSH host. */
export type HomeContinueKind =
  | { kind: 'agent'; agentId: string }
  | { kind: 'terminal' }
  | { kind: 'ssh' };

export function homeContinueKind(destination: HomeContinueEntry['destination']): HomeContinueKind {
  const target = homeContinueTarget(destination);
  if (target?.kind === 'agent-session')
    return { kind: 'agent', agentId: homeTargetAgentId(target) };
  if (target?.kind === 'ssh-host') return { kind: 'ssh' };
  return { kind: 'terminal' };
}

/** The word an agent session's status is shown as; `labels.ts` spells it. */
export type AgentSessionStatusWord =
  | 'running'
  | 'idle'
  | 'failed'
  | 'stopped'
  | 'retrying'
  | 'unknown';

/** The OpenCode status mapping, shared by every agent's session row. */
export function agentSessionStatusPresentation(status: HomeSessionObservation['status']): {
  word: AgentSessionStatusWord;
  tone: 'info' | 'danger' | 'warning' | 'textSubtle';
} {
  switch (status) {
    case 'busy':
      return { word: 'running', tone: 'info' };
    case 'retry':
      return { word: 'retrying', tone: 'info' };
    case 'idle':
      return { word: 'idle', tone: 'textSubtle' };
    case 'failed':
      return { word: 'failed', tone: 'danger' };
    case 'interrupted':
      return { word: 'stopped', tone: 'warning' };
    default:
      return { word: 'unknown', tone: 'textSubtle' };
  }
}

/**
 * The Home command a Continue row runs.
 *
 * A pane row and a remembered terminal both resume the server on that pane, so
 * an embedded Pad overview hands the pane to the workspace it sits on. Only a
 * remembered agent session opens the agent workbench, and only an SSH target
 * opens the SSH host; `resume-target` routes both by the target's own kind.
 */
export function homeContinueCommand(destination: HomeContinueEntry['destination']): HomeCommand {
  if (destination.type === 'pane') {
    return {
      type: 'resume-server',
      target: {
        kind: 'gateway-terminal',
        serverId: destination.serverId,
        ...(destination.paneId ? { paneId: destination.paneId } : {}),
      },
    };
  }
  if (destination.type === 'agent-session') {
    const { serverId, sessionId, directory, asid, agentId } = destination.target;
    return {
      type: 'open-agent',
      target: { kind: 'agent-session', serverId, sessionId, directory, asid, agentId },
    };
  }
  return { type: 'resume-target', target: destination.target };
}

/** The first screenful is generous; expansion is only useful after it. */
export const HOME_CONTINUE_INITIAL_LIMIT = 10;

export function visibleHomeContinueEntries(
  entries: readonly HomeContinueEntry[],
  expanded: boolean
): readonly HomeContinueEntry[] {
  return expanded ? entries : entries.slice(0, HOME_CONTINUE_INITIAL_LIMIT);
}

export function shouldShowHomeContinueOverflow(entries: readonly HomeContinueEntry[]): boolean {
  return entries.length > HOME_CONTINUE_INITIAL_LIMIT;
}

/**
 * Same pane inventory/filter as Classic. Visits rank rows, never create pane
 * inventory. The chosen gateway's own agent sessions join them: one it lists
 * that a recent already points at is that recent (with the gateway's agent,
 * which wins over what the device wrote down), and the rest are new rows,
 * ranked by when the gateway last saw them change.
 */
export function homeContinueEntries({
  serverIds,
  hostIds,
  snapshots,
  recents,
  reachabilityByServer,
  paneMode,
  gatewaySessions,
  goneSessions,
}: {
  serverIds: readonly string[];
  hostIds: readonly string[];
  snapshots: ServerAgentsIndex;
  recents: readonly HomeRecentEntry[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  paneMode: HomeServerPaneMode;
  /** The selected gateway's agent sessions; an offline or unpaired one contributes nothing. */
  gatewaySessions?: GatewayAgentSessionsSnapshot;
  /** Sessions the gateway answered gone for (`goneSessionKey`); they are neither recents nor new rows. */
  goneSessions?: ReadonlySet<string>;
}): HomeContinueEntry[] {
  const rows: HomeContinueEntry[] = [];
  const isGone = (serverId: string, asid: string) =>
    goneSessions?.has(goneSessionKey(serverId, asid)) === true;
  const listed =
    gatewaySessions &&
    serverIds.includes(gatewaySessions.serverId) &&
    reachabilityByServer[gatewaySessions.serverId] !== 'offline'
      ? gatewaySessions
      : undefined;
  const unclaimed = new Map(
    listed?.sessions
      .filter((session) => !isGone(listed.serverId, session.asid))
      .map((session) => [session.asid, session])
  );
  for (const serverId of serverIds) {
    if (reachabilityByServer[serverId] === 'offline') continue;
    // Read as of the snapshot itself, so the row keeps the status it reported;
    // whether that is still current is the row's to say (`homeContinueObservationNow`).
    const snapshot = snapshots[serverId];
    const model = homeServerModel({
      serverId,
      snapshot,
      reachability: reachabilityByServer[serverId] ?? 'unknown',
      paneMode,
      nowMs: snapshot?.checkedAtMs ?? 0,
    });
    for (const { key, agent, spokenCaption } of model.rows) {
      const visited = recents.find(
        ({ target }) =>
          target.kind === 'gateway-terminal' &&
          target.serverId === serverId &&
          target.paneId === agent.paneId &&
          snapshotCoversSession(model.snapshot, target.sessionId)
      );
      rows.push({
        key,
        title: agent.name,
        atMs: visited?.atMs ?? 0,
        ...(agent.agentLabel ? { agentLabel: agent.agentLabel } : {}),
        observation:
          agent.hasAgent && model.snapshot
            ? {
                kind: 'gateway-agent',
                observedAtMs: model.snapshot.checkedAtMs,
                seen: { panesOf: serverId },
                ...(spokenCaption?.kind === 'status' ? { status: spokenCaption.status } : {}),
              }
            : undefined,
        destination: { type: 'pane', serverId, paneId: agent.paneId, cwd: agent.cwd },
      });
    }
  }
  for (const entry of recents) {
    const target = entry.target;
    if (
      target.kind === 'ssh-host'
        ? !hostIds.includes(target.hostId)
        : !serverIds.includes(target.serverId)
    )
      continue;
    if (target.kind !== 'ssh-host' && reachabilityByServer[target.serverId] === 'offline') continue;
    if (target.kind === 'agent-session' && isGone(target.serverId, target.asid)) continue;
    if (
      target.kind === 'gateway-terminal' &&
      supersededTerminalRecent(target, snapshots[target.serverId], paneMode)
    )
      continue;
    const reported =
      listed && target.kind === 'agent-session' && target.serverId === listed.serverId
        ? unclaimed.get(target.asid)
        : undefined;
    if (reported) unclaimed.delete(reported.asid);
    const stored = entry.sessionObservation;
    const sessionObservation =
      reported && listed && (!stored || stored.observedAtMs <= listed.observedAtMs)
        ? { status: reported.status, observedAtMs: listed.observedAtMs }
        : stored;
    rows.push({
      key: entry.key,
      title: entry.title || (reported ? reportedTitle(reported) : ''),
      atMs: reported ? Math.max(entry.atMs, reported.updatedMs) : entry.atMs,
      observation:
        target.kind === 'agent-session' && sessionObservation
          ? {
              kind: 'agent-session',
              status: sessionObservation.status,
              observedAtMs: sessionObservation.observedAtMs,
              seen: { recentKey: entry.key, ...(reported ? { listedBy: target.serverId } : {}) },
            }
          : undefined,
      destination: {
        type: 'recent',
        target:
          reported && target.kind === 'agent-session'
            ? { ...target, agentId: reported.agentId }
            : target,
      },
    });
  }
  if (listed) {
    for (const session of unclaimed.values()) {
      const target: HomeAgentSessionTarget = {
        kind: 'agent-session',
        serverId: listed.serverId,
        sessionId: listed.sessionId,
        directory: session.directory,
        asid: session.asid,
        agentId: session.agentId,
      };
      rows.push({
        key: homeTargetKey(target),
        title: reportedTitle(session),
        atMs: session.updatedMs,
        observation: {
          kind: 'agent-session',
          status: session.status,
          observedAtMs: listed.observedAtMs,
          seen: { listedBy: listed.serverId },
        },
        destination: { type: 'agent-session', target },
      });
    }
  }
  return rows.sort((a, b) => b.atMs - a.atMs);
}

type GatewayTerminalTarget = Extract<HomeTarget, { kind: 'gateway-terminal' }>;

/** A snapshot without a recorded session predates the field and covers every session. */
function snapshotCoversSession(
  snapshot: ServerAgentsSnapshot | undefined,
  sessionId: string
): boolean {
  return snapshot?.sessionId === undefined || snapshot.sessionId === sessionId;
}

/**
 * Whether a remembered terminal is already accounted for by the server's pane
 * snapshot: either its pane is a snapshot row (which carries the visit), or
 * the snapshot is for the same Herdr session and the pane is gone from it
 * (provable only when the snapshot was not cut at `MAX_SERVER_AGENTS`).
 * A pane the pane filter hides, or one in another session, keeps its recent
 * row -- the user went there, so Continue offers it back. A snapshot written
 * before it recorded its session keeps the old rule: it supersedes every
 * terminal recent for its server.
 */
export function supersededTerminalRecent(
  target: GatewayTerminalTarget,
  candidate: ServerAgentsSnapshot | undefined,
  paneMode: HomeServerPaneMode
): boolean {
  const snapshot = candidate?.serverId === target.serverId ? candidate : undefined;
  if (!snapshot) return false;
  if (snapshot.sessionId === undefined) return true;
  if (snapshot.sessionId !== target.sessionId) return false;
  const pane = snapshot.agents.find((agent) => agent.paneId === target.paneId);
  // A full snapshot was cut at the mirror's cap, so a missing pane may be open.
  if (!pane) return snapshot.agents.length < MAX_SERVER_AGENTS;
  return paneMode === 'all' || pane.hasAgent;
}

/** A generated placeholder title is no title; the row then falls back to its caption. */
function reportedTitle(session: GatewayAgentSession): string {
  return hasRealSessionTitle(session) ? session.title.trim() : '';
}

function observationAgeParts(observedAtMs: number, nowMs: number): HomeContinueAge {
  const seconds = Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
  if (seconds < 90) return { unit: 'now', value: 0 };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

/** The computer a Recent row belongs to; `undefined` for an SSH host. */
export function homeContinueServerId(entry: HomeContinueEntry): string | undefined {
  if (entry.destination.type === 'pane') return entry.destination.serverId;
  const target = entry.destination.target;
  return target.kind === 'ssh-host' ? undefined : target.serverId;
}

/**
 * The computers Recent offers a filter chip for, in the reader's own order:
 * only those with a row, and none at all unless there are two to choose from.
 */
export function homeRecentFilterIds(
  entries: readonly HomeContinueEntry[],
  serverIds: readonly string[]
): string[] {
  const present = new Set(entries.map(homeContinueServerId));
  const ids = serverIds.filter((serverId) => present.has(serverId));
  return ids.length > 1 ? ids : [];
}

/** Recent narrowed to one computer; every row when no chip is picked. */
export function filterHomeRecent(
  entries: readonly HomeContinueEntry[],
  serverId: string | null
): readonly HomeContinueEntry[] {
  if (!serverId) return entries;
  return entries.filter((entry) => homeContinueServerId(entry) === serverId);
}
