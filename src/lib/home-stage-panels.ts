/**
 * What the Stage's HUD shows of each computer, read from the same Home
 * state Classic and Editorial read: the launch controller's computers, their
 * connection statuses, the mirrored agents, the attention observations, the
 * task ledgers and the Recent entries. A presentation adapter only -- it
 * reshapes nothing it is given and fetches nothing.
 *
 * The header and the agents' row say what the computer is doing now and
 * whether it needs the reader; where to jump back in is the session strip's
 * job, so no session titles appear here.
 */
import { hasRealSessionTitle } from './agent-protocol';
import type { HomeAttentionSnapshot } from './home-attention';
import {
  homeContinueKind,
  homeContinueRowPane,
  homeContinueServerId,
  homeContinueTarget,
  type GatewayAgentSession,
  type GatewayAgentSessionsSnapshot,
  type HomeContinueEntry,
} from './home-continue';
import { agentDisplayName } from './home-launch-model';
import { homeTargetAgentId, type HomeTarget } from './home-recents';
import type { AgentStatus } from './herdr-entity';
import {
  isServerAgentsStale,
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgent,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from './server-agents';
import { reachabilityOfStatus, type ConnectionStatus } from './server-reachability';
import type { ServerTasksIndex } from './server-tasks-state';
import type { TaskView } from './task-ledger';

export type StagePanelTone = 'online' | 'offline' | 'unknown' | 'warning';

/** What an agent's chip says: it waits on the reader, it runs, or neither. */
export type StageAgentMark = 'working' | 'needs-you' | 'idle';

type StageSessionTarget = Extract<HomeTarget, { kind: 'agent-session' }>;

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
  /** The pane it runs in, so a tap on its chip lands there; absent when unknown. */
  paneId?: string;
  /**
   * A native agent session (the gateway's listing), whose chip opens its
   * conversation; absent for a terminal pane's agent.
   */
  session?: StageSessionTarget;
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
  /** When the app last confirmed its agents with it, for "last seen"; offline only. */
  lastSeenMs?: number;
  /**
   * Its agents as conversations (`stageAgentLines`): native sessions first,
   * then the terminal agents no listed session stands for; none on an
   * offline computer.
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
  agentSessions = {},
  agentSessionsSeenAtMs = {},
  recentEntries,
  nowMs,
}: {
  servers: readonly { serverId: string; label: string }[];
  connectionStatuses: Readonly<Record<string, ConnectionStatus | undefined>>;
  agentsByServer: ServerAgentsIndex;
  attention: Readonly<Record<string, HomeAttentionSnapshot>>;
  /** The task ledgers Home holds, for what a working agent is doing. */
  tasks?: ServerTasksIndex;
  /** The agent sessions each gateway last listed, and when each list was last confirmed. */
  agentSessions?: Readonly<Record<string, GatewayAgentSessionsSnapshot | undefined>>;
  agentSessionsSeenAtMs?: Readonly<Record<string, number | undefined>>;
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
    // The listing counts while it, or a read that found it unchanged, is recent.
    const listing = agentSessions[server.serverId];
    const listedAtMs = listing
      ? Math.max(listing.observedAtMs, agentSessionsSeenAtMs[server.serverId] ?? 0)
      : 0;
    const listed =
      listing?.serverId === server.serverId && nowMs - listedAtMs <= SERVER_AGENTS_STALE_AFTER_MS
        ? listing
        : undefined;
    const lines = offline
      ? []
      : stageAgentLines({
          serverId: server.serverId,
          panes: snapshot && fresh.length > 0 ? { ...snapshot, agents: fresh } : undefined,
          listed,
          listedAtMs,
          attention,
          tasks: tasks[server.serverId]?.tasks ?? [],
        });
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
      // Shown only while offline; kept off a reachable panel so a routine
      // mirror pass (a new `checkedAtMs`) leaves the panels structurally equal.
      ...(snapshot && offline ? { lastSeenMs: snapshot.checkedAtMs } : {}),
      agents: lines,
    };
  });
}

function needsYou(agent: ServerAgent): boolean {
  return agent.status === 'blocked' || agent.pendingUserInput === true;
}

const MARK_ORDER: Record<StageAgentMark, number> = { 'needs-you': 0, working: 1, idle: 2 };

const RUNNING_SESSION: readonly string[] = ['busy', 'retry'];

/**
 * The pane a listed session runs in, by the gateway's own word
 * (`runtime.terminal`): the same incarnation when the gateway named one, else
 * the same pane as of a listing at least as new as the mirror (pane ids are
 * reused). Nothing is inferred from titles or folders.
 */
function sessionPane(
  session: GatewayAgentSession,
  panes: ServerAgentsSnapshot | undefined,
  listedAtMs: number
): ServerAgent | undefined {
  const terminal = session.terminal;
  if (!terminal || !panes || panes.sessionId !== terminal.sessionId) return undefined;
  const pane = panes.agents.find((agent) => agent.paneId === terminal.paneId);
  if (!pane) return undefined;
  if (terminal.instanceId) return pane.instanceId === terminal.instanceId ? pane : undefined;
  return listedAtMs >= panes.checkedAtMs ? pane : undefined;
}

/** Native session chips shown before terminal agents, unless more are live. */
const NATIVE_CHIP_LIMIT = 6;

/**
 * The computer's agents for the chips, as conversations. Native sessions
 * first: every live one -- running, waited on by a request, or running in a
 * terminal pane by the gateway's word (that pane is this session, shown once,
 * as the session) -- then, up to `NATIVE_CHIP_LIMIT`, each other agent's most
 * recent session, so an idle agent still opens its conversation. Then only
 * the terminal agents no listed session stands for.
 */
function stageAgentLines({
  serverId,
  panes,
  listed,
  listedAtMs,
  attention,
  tasks,
}: {
  serverId: string;
  /** The fresh mirror, its agents only. */
  panes?: ServerAgentsSnapshot;
  /** The fresh listing, as of `listedAtMs`. */
  listed?: GatewayAgentSessionsSnapshot;
  listedAtMs: number;
  attention: Readonly<Record<string, HomeAttentionSnapshot>>;
  tasks: readonly TaskView[];
}): StageAgentLine[] {
  const claimed = new Set<string>();
  const live: StageAgentLine[] = [];
  const recent: StageAgentLine[] = [];
  for (const session of listed?.serverId === serverId ? listed.sessions : []) {
    const pane = sessionPane(session, panes, listedAtMs);
    if (pane?.paneId) claimed.add(pane.paneId);
    const asking = Object.values(attention).some(
      ({ target, requestIds }) =>
        requestIds.length > 0 &&
        target.serverId === serverId &&
        target.asid === session.asid &&
        homeTargetAgentId(target) === session.agentId
    );
    const mark: StageAgentMark =
      asking || (pane?.hasAgent && needsYou(pane))
        ? 'needs-you'
        : RUNNING_SESSION.includes(session.status) || (pane?.hasAgent && pane.status === 'working')
          ? 'working'
          : 'idle';
    const title = hasRealSessionTitle(session) ? session.title.trim() : undefined;
    (mark !== 'idle' || pane ? live : recent).push({
      key: `session:${session.agentId}:${session.asid}`,
      name: agentDisplayName(undefined, session.agentId),
      mark,
      status: mark === 'needs-you' ? 'blocked' : mark,
      ...(title ? { activity: title } : {}),
      session: {
        kind: 'agent-session',
        serverId,
        sessionId: listed!.sessionId,
        directory: session.directory,
        asid: session.asid,
        agentId: session.agentId,
      },
    });
  }
  // The listing is newest first: the first session of each agent not live already.
  const shown = new Set(live.map((line) => line.session!.agentId));
  const latest = recent.filter((line) => {
    const agentId = line.session!.agentId;
    if (shown.has(agentId)) return false;
    shown.add(agentId);
    return true;
  });
  const terminals = (panes?.agents ?? []).filter(
    (agent) => agent.hasAgent && !(agent.paneId && claimed.has(agent.paneId))
  );
  return [
    ...byMark(live),
    ...latest.slice(0, Math.max(0, NATIVE_CHIP_LIMIT - live.length)),
    ...agentLines(terminals, tasks),
  ];
}

/** Waiting on the reader first, then running, then the rest, each in the order given. */
function byMark(lines: readonly StageAgentLine[]): StageAgentLine[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => MARK_ORDER[a.line.mark] - MARK_ORDER[b.line.mark] || a.index - b.index)
    .map(({ line }) => line);
}

/** Waiting on the reader first, then running, then the rest, each in mirror order. */
function agentLines(agents: readonly ServerAgent[], tasks: readonly TaskView[]): StageAgentLine[] {
  return byMark(
    agents.map((agent): StageAgentLine => {
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
  );
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

/** Where the selected computer stands among the computers; 0 when it is not there. */
export function stageSelectedIndex(
  panels: readonly { serverId: string }[],
  serverId: string | undefined
): number {
  const index = serverId ? panels.findIndex((panel) => panel.serverId === serverId) : -1;
  return index < 0 ? 0 : index;
}

/** One agent in the HUD's agents' row. */
export type StageAgentChip = {
  key: string;
  name: string;
  mark: StageAgentMark;
  /** The pane a tap opens; absent when unknown (the computer opens instead). */
  paneId?: string;
  /** The native conversation a tap opens; absent for a terminal pane's agent. */
  session?: StageSessionTarget;
  /** The state named beside the name: never for an idle agent, whose dot says enough. */
  word: Exclude<StageAgentMark, 'idle'> | null;
};

/**
 * The HUD's agents' row for a computer: an offline computer's row is one
 * muted "offline, last seen" line instead of chips (its agents are not what
 * they were); otherwise one chip per agent: native sessions before terminal
 * panes, each waiting on the reader first, then running, then idle, each in
 * the order given.
 */
export type StageAgentRow =
  | { kind: 'offline'; lastSeenMs?: number }
  | { kind: 'agents'; chips: StageAgentChip[] };

export function stageAgentRow(
  panel: Pick<StagePanel, 'tone' | 'lastSeenMs' | 'agents'>
): StageAgentRow {
  if (panel.tone === 'offline')
    return panel.lastSeenMs === undefined
      ? { kind: 'offline' }
      : { kind: 'offline', lastSeenMs: panel.lastSeenMs };
  const chips = panel.agents
    .map((agent, index) => ({ agent, index }))
    .sort(
      (a, b) =>
        Number(!a.agent.session) - Number(!b.agent.session) ||
        MARK_ORDER[a.agent.mark] - MARK_ORDER[b.agent.mark] ||
        a.index - b.index
    )
    .map(({ agent }): StageAgentChip => ({
      key: agent.key,
      name: agent.name,
      mark: agent.mark,
      ...(agent.paneId ? { paneId: agent.paneId } : {}),
      ...(agent.session ? { session: agent.session } : {}),
      word: agent.mark === 'idle' ? null : agent.mark,
    }));
  return { kind: 'agents', chips };
}

/** A needs-you or running terminal agent: the strip keeps it in view. */
function urgentTerminal(entry: HomeContinueEntry): boolean {
  const observation = entry.observation;
  return (
    observation?.kind === 'gateway-agent' &&
    (observation.pendingUserInput === true ||
      observation.status === 'blocked' ||
      observation.status === 'working')
  );
}

/**
 * The session strip's cards for the selected computer, from its Recent rows
 * (newest first): native agent sessions first, then terminal panes, each in
 * the order given, at most `limit`. A terminal pane the gateway says hosts a
 * listed session's same incarnation (`runtime.terminal` with its instance) is
 * that session and is left out; Recent already drops the rest it can prove.
 * A terminal waiting on the reader or running keeps its place within the
 * limit, displacing the oldest of the others.
 */
export function stageStripSessions({
  entries,
  listed,
  panes,
  limit,
}: {
  entries: readonly HomeContinueEntry[];
  listed?: GatewayAgentSessionsSnapshot;
  panes?: ServerAgentsSnapshot;
  limit: number;
}): HomeContinueEntry[] {
  const claimed = new Set<string>();
  for (const entry of entries) {
    const target = homeContinueTarget(entry.destination);
    if (target?.kind !== 'agent-session' || !listed || target.serverId !== listed.serverId)
      continue;
    const terminal = listed.sessions.find(
      (session) => session.asid === target.asid && session.agentId === homeTargetAgentId(target)
    )?.terminal;
    if (
      terminal?.instanceId &&
      panes?.serverId === listed.serverId &&
      panes.sessionId === terminal.sessionId &&
      panes.agents.some(
        (agent) => agent.paneId === terminal.paneId && agent.instanceId === terminal.instanceId
      )
    )
      claimed.add(JSON.stringify([terminal.sessionId, terminal.paneId]));
  }
  const native: HomeContinueEntry[] = [];
  const terminals: HomeContinueEntry[] = [];
  for (const entry of entries) {
    if (homeContinueKind(entry.destination).kind === 'agent') {
      native.push(entry);
      continue;
    }
    const pane = homeContinueRowPane(entry);
    if (pane?.sessionId && claimed.has(JSON.stringify([pane.sessionId, pane.paneId]))) continue;
    terminals.push(entry);
  }
  const kept = new Set(terminals.filter(urgentTerminal).slice(0, limit));
  let room = limit - kept.size;
  return [...native, ...terminals].filter((entry) => {
    if (kept.has(entry)) return true;
    if (room <= 0) return false;
    room -= 1;
    return true;
  });
}
