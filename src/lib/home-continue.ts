import { hasRealSessionTitle, type AgentSessionInfo } from './agent-protocol';
import type { HomeCommand } from './home-commands';
import {
  homeTargetAgentId,
  type HomeRecentEntry,
  type HomeSessionObservation,
  type HomeTarget,
} from './home-recents';
import {
  homeServerModel,
  homeServerRowKey,
  type HomeServerModel,
  type HomeServerPaneMode,
} from './home-server-model';
import type { HomeThreadTarget } from './home-thread';
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
      pendingUserInput?: boolean;
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
  | {
      kind: 'gateway-agent';
      status?: ServerAgent['status'];
      pendingUserInput?: boolean;
      age: HomeContinueAge;
      stale: boolean;
    }
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
      ...(!stale && observation.pendingUserInput === true ? { pendingUserInput: true } : {}),
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
    | { type: 'pane'; serverId: string; sessionId?: string; paneId?: string; cwd?: string }
    | { type: 'recent'; target: HomeTarget }
    /** An agent session the gateway listed that this device has no recent for. */
    | { type: 'agent-session'; target: HomeAgentSessionTarget };
};

type HomeAgentSessionTarget = Extract<HomeTarget, { kind: 'agent-session' }>;

/** The identity a gone agent session is remembered by: one gateway's one session. */
export function goneSessionKey(serverId: string, asid: string, agentId?: string): string {
  return JSON.stringify(agentId ? [serverId, asid, agentId] : [serverId, asid]);
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
  /**
   * The terminal pane the gateway observed this session running in
   * (`runtime.terminal`), when it runs in one. This is the gateway's own word
   * that the session and that pane are the same work, which is what lets
   * Continue show the work once rather than as a session row and a pane row.
   */
  terminal?: { sessionId: string; paneId: string; instanceId?: string };
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
      ...(info.runtime?.terminal
        ? {
            terminal: {
              sessionId: info.runtime.terminal.session_id,
              paneId: info.runtime.terminal.pane_id,
              instanceId: info.runtime.terminal.instance_id,
            },
          }
        : {}),
    }));
}

/** The pane a Continue row stands for, when it is a pane or a remembered terminal. */
function continueRowPane(
  entry: HomeContinueEntry
): { serverId: string; sessionId?: string; paneId: string } | null {
  if (entry.destination.type === 'pane') {
    const { serverId, sessionId, paneId } = entry.destination;
    return paneId ? { serverId, sessionId, paneId } : null;
  }
  const target = homeContinueTarget(entry.destination);
  return target?.kind === 'gateway-terminal'
    ? { serverId: target.serverId, sessionId: target.sessionId, paneId: target.paneId }
    : null;
}

function paneKey(serverId: string, sessionId: string, paneId: string): string {
  return JSON.stringify([serverId, sessionId, paneId]);
}

/** Keep known routing sessions distinct even when their local pane/instance IDs repeat. */
function scopedPaneRowKey(key: string, sessionId?: string): string {
  return sessionId ? JSON.stringify([key, sessionId]) : key;
}

/**
 * At the same instant, the richer row first: a session over the pane it
 * might be running in, a pane over a connection shortcut. Only a tiebreak;
 * recency decides everything else.
 */
function continueKindRank(entry: HomeContinueEntry): number {
  const target = homeContinueTarget(entry.destination);
  if (target?.kind === 'agent-session') return 0;
  if (target?.kind === 'ssh-host') return 2;
  return 1;
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
        ...(destination.sessionId ? { sessionId: destination.sessionId } : {}),
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

/** Home previews five sessions before expanding the same list in place. */
export const HOME_CONTINUE_INITIAL_LIMIT = 5;

export function visibleHomeContinueEntries(
  entries: readonly HomeContinueEntry[],
  expanded: boolean,
  limit = HOME_CONTINUE_INITIAL_LIMIT
): readonly HomeContinueEntry[] {
  return expanded ? entries : entries.slice(0, limit);
}

export function shouldShowHomeContinueOverflow(
  entries: readonly HomeContinueEntry[],
  limit = HOME_CONTINUE_INITIAL_LIMIT
): boolean {
  return entries.length > limit;
}

/**
 * Same pane inventory/filter as Classic. Visits rank rows, never create pane
 * inventory. The chosen gateway's own agent sessions join them: one it lists
 * that a recent already points at is that recent (with the gateway's agent,
 * which wins over what the device wrote down), and the rest are new rows,
 * ranked by when the gateway last saw them change.
 *
 * Every row -- agent session, terminal pane, connection shortcut -- is
 * ordered by its most recent activity alone, so an agent that only exists as
 * a terminal pane (Claude Code in tmux, say) sits where its recency puts it
 * rather than under every session. "Session over terminal" is only a rule of
 * identity: when the gateway says a listed session runs in a terminal pane
 * (`GatewayAgentSession.terminal`, from the session's `runtime.terminal`),
 * that pane's row and any remembered visit to it are the same work as the
 * session row, and only the session row is kept. The gateway's word is the
 * only linkage used; nothing is inferred from titles or folders.
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
  threads,
  connectionShortcutsElsewhere = false,
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
  /**
   * The conversations Home's dock is talking to, one per computer. Each is a
   * row from the moment Home starts or targets it, before any listing or pane
   * read has caught up: see {@link withHomeThreadRows}.
   */
  threads?: readonly HomeThreadTarget[];
  /** Suppress shortcuts represented elsewhere; Classic's entry-only cards keep this false. */
  connectionShortcutsElsewhere?: boolean;
}): HomeContinueEntry[] {
  const rows: HomeContinueEntry[] = [];
  const isGone = (serverId: string, asid: string, agentId: string) =>
    goneSessions?.has(goneSessionKey(serverId, asid)) === true ||
    goneSessions?.has(goneSessionKey(serverId, asid, agentId)) === true;
  const listed =
    gatewaySessions &&
    serverIds.includes(gatewaySessions.serverId) &&
    reachabilityByServer[gatewaySessions.serverId] !== 'offline'
      ? gatewaySessions
      : undefined;
  const unclaimed = new Map(
    listed?.sessions
      .filter((session) => !isGone(listed.serverId, session.asid, session.agentId))
      .map((session) => [goneSessionKey(listed.serverId, session.asid, session.agentId), session])
  );
  for (const serverId of serverIds) {
    if (connectionShortcutsElsewhere) continue;
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
    for (const { key, agent, spokenCaption, pendingUserInput } of model.rows) {
      const visited = recents.find(
        ({ target }) =>
          target.kind === 'gateway-terminal' &&
          target.serverId === serverId &&
          target.paneId === agent.paneId &&
          snapshotCoversSession(model.snapshot, target.sessionId)
      );
      rows.push({
        key: scopedPaneRowKey(key, model.snapshot?.sessionId),
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
                ...(pendingUserInput ? { pendingUserInput: true } : {}),
              }
            : undefined,
        destination: {
          type: 'pane',
          serverId,
          ...(model.snapshot?.sessionId ? { sessionId: model.snapshot.sessionId } : {}),
          paneId: agent.paneId,
          cwd: agent.cwd,
        },
      });
    }
  }
  for (const entry of recents) {
    const target = entry.target;
    if (
      connectionShortcutsElsewhere &&
      target.kind === 'ssh-host' &&
      hostIds.includes(target.hostId)
    )
      continue;
    if (
      target.kind === 'ssh-host'
        ? !hostIds.includes(target.hostId)
        : !serverIds.includes(target.serverId)
    )
      continue;
    if (target.kind !== 'ssh-host' && reachabilityByServer[target.serverId] === 'offline') continue;
    if (
      target.kind === 'agent-session' &&
      isGone(target.serverId, target.asid, homeTargetAgentId(target))
    )
      continue;
    if (
      target.kind === 'gateway-terminal' &&
      supersededTerminalRecent(target, snapshots[target.serverId], paneMode)
    )
      continue;
    const matching =
      listed && target.kind === 'agent-session' && target.serverId === listed.serverId
        ? [...unclaimed.values()].filter(
            (session) =>
              session.asid === target.asid &&
              (!target.agentId || session.agentId === homeTargetAgentId(target))
          )
        : [];
    // A legacy recent without a provider may be repaired only by one unambiguous owner.
    const reported = matching.length === 1 ? matching[0] : undefined;
    if (reported && listed)
      unclaimed.delete(goneSessionKey(listed.serverId, reported.asid, reported.agentId));
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
        key: goneSessionKey(listed.serverId, session.asid, session.agentId),
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
  withHomeThreadRows(rows, threads ?? [], {
    serverIds,
    reachabilityByServer,
    snapshots,
    isGone,
    panes: !connectionShortcutsElsewhere,
  });
  // The panes the kept session rows run in, by the gateway's own account.
  const claimedPanes = new Set<string>();
  for (const row of rows) {
    const target = homeContinueTarget(row.destination);
    if (target?.kind !== 'agent-session' || !listed || target.serverId !== listed.serverId)
      continue;
    const session = listed.sessions.find(
      (candidate) => candidate.asid === target.asid && candidate.agentId === target.agentId
    );
    if (session?.terminal)
      claimedPanes.add(
        paneKey(target.serverId, session.terminal.sessionId, session.terminal.paneId)
      );
  }
  return rows
    .filter((row) => {
      const pane = continueRowPane(row);
      if (
        !pane?.sessionId ||
        !claimedPanes.has(paneKey(pane.serverId, pane.sessionId, pane.paneId))
      )
        return true;
      // Pane IDs can be reused. An older listing cannot identify work in a
      // newer mirror or a pane Home targeted after that listing was read.
      const mirror = snapshots[pane.serverId];
      if (mirror?.sessionId === pane.sessionId && mirror.checkedAtMs > (listed?.observedAtMs ?? 0))
        return true;
      return (threads ?? []).some(
        (thread) =>
          thread.kind === 'pane' &&
          thread.serverId === pane.serverId &&
          thread.sessionId === pane.sessionId &&
          thread.paneId === pane.paneId &&
          thread.setAtMs > (listed?.observedAtMs ?? 0)
      );
    })
    .sort((a, b) => b.atMs - a.atMs || continueKindRank(a) - continueKindRank(b));
}

/**
 * Home's dock conversations, merged into the rows in place.
 *
 * A session or pane Home just started is the reply target at once, but the
 * listing and the pane mirror only name it on their next read. Until then the
 * target is its own row, under the key the listing (`goneSessionKey`) or the
 * pane mirror (`homeServerRowKey`) will give it, so the read that catches up
 * replaces it with the same card rather than adding a second one. A row that
 * already stands for it is kept, ranked no older than the message Home sent
 * it: what Home caused is activity, and the reader's own ranking of it does
 * not drop back when the read lands. A pane is only stood in for while the
 * mirror predates the target -- a newer one without it says it has gone.
 */
function withHomeThreadRows(
  rows: HomeContinueEntry[],
  threads: readonly HomeThreadTarget[],
  {
    serverIds,
    reachabilityByServer,
    snapshots,
    isGone,
    panes,
  }: {
    serverIds: readonly string[];
    reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
    snapshots: ServerAgentsIndex;
    isGone: (serverId: string, asid: string, agentId: string) => boolean;
    panes: boolean;
  }
): void {
  for (const thread of threads) {
    const { serverId } = thread;
    if (!serverIds.includes(serverId) || reachabilityByServer[serverId] === 'offline') continue;
    if (thread.kind === 'task') continue;
    const index = rows.findIndex((row) => {
      if (thread.kind === 'pane') {
        const pane = continueRowPane(row);
        return (
          pane?.serverId === serverId &&
          pane.paneId === thread.paneId &&
          pane.sessionId === thread.sessionId
        );
      }
      const target = homeContinueTarget(row.destination);
      return (
        target?.kind === 'agent-session' &&
        target.serverId === serverId &&
        target.asid === thread.asid &&
        homeTargetAgentId(target) === homeTargetAgentId(thread)
      );
    });
    const existing = rows[index];
    if (existing) {
      const atMs = Math.max(existing.atMs, thread.sentAtMs ?? 0);
      const title = existing.title || thread.title;
      if (atMs !== existing.atMs || title !== existing.title)
        rows[index] = { ...existing, atMs, title };
      continue;
    }
    const atMs = thread.sentAtMs ?? thread.setAtMs;
    if (thread.kind === 'session') {
      const agentId = thread.agentId;
      if (isGone(serverId, thread.asid, agentId ?? '')) continue;
      rows.push({
        key: agentId
          ? goneSessionKey(serverId, thread.asid, agentId)
          : goneSessionKey(serverId, thread.asid),
        title: thread.title,
        atMs,
        destination: {
          type: 'agent-session',
          target: {
            kind: 'agent-session',
            serverId,
            sessionId: thread.sessionId,
            directory: thread.directory ?? '',
            asid: thread.asid,
            ...(agentId ? { agentId } : {}),
          },
        },
      });
      continue;
    }
    if (!panes) continue;
    const snapshot = snapshots[serverId];
    const current =
      snapshot?.serverId === serverId &&
      snapshot.checkedAtMs >= thread.setAtMs &&
      snapshot.sessionId === thread.sessionId;
    if (current) continue;
    rows.push({
      key: scopedPaneRowKey(
        homeServerRowKey(serverId, { instanceId: thread.instanceId, paneId: thread.paneId }),
        thread.sessionId
      ),
      title: thread.title,
      atMs,
      ...(thread.agentLabel ? { agentLabel: thread.agentLabel } : {}),
      destination: {
        type: 'pane',
        serverId,
        ...(thread.sessionId ? { sessionId: thread.sessionId } : {}),
        paneId: thread.paneId,
      },
    });
  }
}

type GatewayTerminalTarget = Extract<HomeTarget, { kind: 'gateway-terminal' }>;

/** Only a snapshot of the same routing session can claim a remembered pane. */
function snapshotCoversSession(
  snapshot: ServerAgentsSnapshot | undefined,
  sessionId: string
): boolean {
  return snapshot?.sessionId === sessionId;
}

/**
 * Whether a remembered terminal is already accounted for by the server's pane
 * snapshot: either its pane is a snapshot row (which carries the visit), or
 * the snapshot is for the same Herdr session and the pane is gone from it
 * (provable only when the snapshot was not cut at `MAX_SERVER_AGENTS`).
 * A pane the pane filter hides, or one in another session, keeps its recent
 * row -- the user went there, so Continue offers it back. A snapshot written
 * before it recorded its session cannot prove that any remembered pane is
 * the same one, so it keeps those recent destinations.
 */
export function supersededTerminalRecent(
  target: GatewayTerminalTarget,
  candidate: ServerAgentsSnapshot | undefined,
  paneMode: HomeServerPaneMode
): boolean {
  const snapshot = candidate?.serverId === target.serverId ? candidate : undefined;
  if (!snapshot) return false;
  if (snapshot.sessionId === undefined) return false;
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
