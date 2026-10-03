/**
 * Agents, as pure decisions.
 *
 * A gateway now drives more than one agent -- OpenCode, DeepSeek Harness, T3
 * Code, and whatever comes next. `GET /api/discovery` lists them; every
 * session, catalog and status read can name one by `agent_id`. This file holds
 * what the app decides about that list without a network or a native store
 * behind it: which capability turns discovery on, what an agent's status means
 * for a Home entry, which agent a new session goes to, what a persisted mirror
 * of the answer looks like, and which of the composer's own commands an agent
 * cannot answer.
 *
 * The parsers live in `agent-protocol.ts` beside the rest of the wire
 * contract; the store in `stores/agents.ts` is a thin holder of what is
 * decided here.
 */

import type { AgentClientCommandId } from './agent-commands';
import {
  DEFAULT_AGENT_ID,
  defaultAgentFeatures,
  normalizeAgentId,
  parseAgentAvailability,
  parseAgentFeatures,
  parseTransportsDiscovery,
  type AgentAvailability,
  type AgentFeatures,
  type AgentInfo,
  type AgentsDiscovery,
  type GatewayDiscovery,
  type SshDiscovery,
  type TerminalDiscovery,
  type TransportsDiscovery,
} from './agent-protocol';
import { parseKeyboardVocabulary } from './key-vocabulary';

export { DEFAULT_AGENT_ID, normalizeAgentId };

/** The capability that says `/api/discovery` carries an agents plane. */
export const MULTI_AGENT_CAPABILITY = 'multi_agent';

/** Whether a health answer's capability list says discovery is worth asking for. */
export function hasMultiAgent(capabilities: readonly string[] | undefined | null): boolean {
  return Boolean(capabilities?.includes(MULTI_AGENT_CAPABILITY));
}

/**
 * Whether an agent id belongs on the wire.
 *
 * The default agent is what every route answers for when nothing is said, so
 * naming it buys nothing and, on a gateway older than the parameter, could
 * cost a `400`. Only a non-default agent is spelled out.
 */
export function agentIdQueryValue(agentId: string | undefined | null): string | undefined {
  const id = normalizeAgentId(agentId);
  return id === DEFAULT_AGENT_ID ? undefined : id;
}

/** `?agent_id=<id>` appended to `path`, or `path` alone for the default agent. */
export function withAgentIdQuery(path: string, agentId: string | undefined | null): string {
  const value = agentIdQueryValue(agentId);
  if (!value) return path;
  return `${path}${path.includes('?') ? '&' : '?'}agent_id=${encodeURIComponent(value)}`;
}

/**
 * `?agent_id=<id>` for any agent named, the default one included.
 *
 * For the reads a multi-agent gateway answers per agent -- the catalog and
 * the projects. Asked without an agent it merges every agent's answer, so an
 * OpenCode session's mode sheet listed DeepSeek's presets as well. The caller
 * names an agent only on a gateway that has discovery; an older one has one
 * agent, no parameter, and gets the path alone.
 */
export function withScopedAgentId(path: string, agentId: string | undefined | null): string {
  const value = agentId?.trim();
  if (!value) return path;
  return `${path}${path.includes('?') ? '&' : '?'}agent_id=${encodeURIComponent(value)}`;
}

/** The cache-key variant for a read made with `withScopedAgentId`. */
export function scopedAgentCacheVariant(
  variant: string | null | undefined,
  agentId: string | undefined | null
): string | null {
  const value = agentId?.trim();
  if (!value) return variant ?? null;
  const suffix = `agent=${value}`;
  return variant ? `${variant};${suffix}` : suffix;
}

/**
 * A cache-key variant with the agent folded in, or the variant untouched for
 * the default agent -- so every entry written before agents existed is still
 * the entry the default agent reads.
 */
export function agentCacheVariant(
  variant: string | null | undefined,
  agentId: string | undefined | null
): string | null {
  const value = agentIdQueryValue(agentId);
  if (!value) return variant ?? null;
  const suffix = `agent=${value}`;
  return variant ? `${variant};${suffix}` : suffix;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** What every decision below needs of an agent, mirrored or live. */
type AgentIdentity = Pick<AgentInfo, 'id' | 'kind' | 'status' | 'enabled'>;

/** What Home says about an agent, in the vocabulary the OpenCode card already used. */
export type AgentReadinessStatus =
  | 'ready'
  | 'not-installed'
  | 'needs-setup'
  | 'unsupported'
  | 'offline';

/**
 * An agent's status as a Home readiness.
 *
 * `connected` is attached and answering. `reachable` is a service the gateway
 * can see and has not attached yet, which a session create will attach; both
 * are `ready`. `not_installed` has its own guide page. `unconfigured` is an
 * agent whose server answers but which the gateway holds no credential for
 * (T3 before `t3 pair`): the host needs setup, which is what the kind's guide
 * says, so it is `needs-setup` -- shown, and not launchable. `disabled`, or an
 * agent the gateway lists as not enabled, is a choice made on the host, so it
 * is `unsupported` and not offered. Everything else is a service that should
 * answer and does not.
 */
export function agentReadiness(info: Pick<AgentInfo, 'status' | 'enabled'>): AgentReadinessStatus {
  if (!info.enabled) return 'unsupported';
  switch (info.status) {
    case 'connected':
    case 'reachable':
      return 'ready';
    case 'not_installed':
      return 'not-installed';
    case 'unconfigured':
      return 'needs-setup';
    case 'disabled':
      return 'unsupported';
    default:
      return 'offline';
  }
}

export function isAgentReady(info: Pick<AgentInfo, 'status' | 'enabled'>): boolean {
  return agentReadiness(info) === 'ready';
}

/** The agents a new session may go to, in the gateway's own order. */
export function readyAgents<T extends Pick<AgentInfo, 'status' | 'enabled'>>(
  agents: readonly T[]
): T[] {
  return agents.filter(isAgentReady);
}

/** The listed agent with this id, by `id` first and by `kind` second. */
export function findAgent<T extends Pick<AgentInfo, 'id' | 'kind'>>(
  agents: readonly T[] | undefined,
  agentId: string | undefined | null
): T | undefined {
  if (!agents) return undefined;
  const id = normalizeAgentId(agentId);
  return agents.find((agent) => agent.id === id) ?? agents.find((agent) => agent.kind === id);
}

const SHARED_DEFAULT_FEATURES: AgentFeatures = defaultAgentFeatures();

/**
 * What an agent can do, for a screen that must answer whether or not
 * discovery ever happened.
 *
 * No discovery, or an agent discovery does not list, answers every control
 * on: a gateway too old to be asked loses nothing, and no agent kind is
 * treated differently from another.
 *
 * The answer is the same object for the same input: this runs as a zustand
 * selector, and a fresh default on every call is a snapshot that never
 * settles, which React reports as "Maximum update depth exceeded".
 */
export function agentFeaturesFor(
  agents: readonly Pick<AgentInfo, 'id' | 'kind' | 'features'>[] | undefined,
  agentId: string | undefined | null
): AgentFeatures {
  const found = findAgent(agents, agentId);
  return found ? found.features : SHARED_DEFAULT_FEATURES;
}

/**
 * Whether a session on `agentId` can be moved into a worktree: only when its
 * agent reports `worktrees`. An agent discovery never described keeps the
 * action, as every OpenCode session always had it.
 */
export function canMoveSessionToWorktree(
  agents: readonly Pick<AgentInfo, 'id' | 'kind' | 'features'>[] | undefined,
  agentId: string | undefined | null
): boolean {
  return agentFeaturesFor(agents, agentId).worktrees;
}

/**
 * The agent a new session goes to.
 *
 * The reader's own pick wins while it is still ready; then the first ready
 * agent in the gateway's order, which is its preference order; and with no
 * discovery at all, the default. A pick that has gone offline is not kept:
 * the session would fail to create, and the gateway's own order is the better
 * guess of what works.
 */
export function resolveSelectedAgent(
  selected: string | undefined | null,
  discovery: { agents: readonly AgentIdentity[] } | null | undefined
): string {
  if (!discovery) return normalizeAgentId(selected);
  const picked = selected ? findAgent(discovery.agents, selected) : undefined;
  if (picked && isAgentReady(picked)) return picked.id;
  const ready = readyAgents(discovery.agents);
  if (ready[0]) return ready[0].id;
  return normalizeAgentId(selected);
}

/** Whether a new-session path has a real choice to offer. */
export function offersAgentChoice(
  discovery: { agents: readonly AgentIdentity[] } | null | undefined
): boolean {
  return Boolean(discovery && readyAgents(discovery.agents).length > 1);
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

/**
 * The composer's own slash commands an agent cannot answer.
 *
 * `/undo` and `/keep` stage and withdraw a revert (an agent with only the
 * one-step rollback keeps `/undo`, which asks first, and loses `/keep`); `/compact` asks the agent
 * to fold its context; `/agents` opens the mode sheet. Listing one of them on
 * an agent without the feature offers a command that fails when typed.
 */
export function hiddenClientCommands(features: AgentFeatures): AgentClientCommandId[] {
  const hidden: AgentClientCommandId[] = [];
  if (!features.revert) hidden.push('undo', 'keep');
  // A one-step rollback is never staged, so there is nothing to keep.
  else if (!features.stagedRevert) hidden.push('keep');
  if (!features.compaction) hidden.push('compact');
  if (!features.modes) hidden.push('agents');
  return hidden;
}

// ---------------------------------------------------------------------------
// The persisted mirror
// ---------------------------------------------------------------------------

/**
 * One agent as the mirror keeps it: identity, status and features, and
 * nothing a paired device was told in confidence. Endpoints and versions are
 * dropped; so are the model and mode lists, which are the live catalog's to
 * serve and were most of the document's bytes.
 */
export type MirroredAgent = Omit<AgentInfo, 'endpoint' | 'version' | 'models' | 'modes'>;

export type MirroredAgentsDiscovery = Omit<AgentsDiscovery, 'agents'> & {
  agents: MirroredAgent[];
};

/** What one server's last discovery answer left behind. */
export interface MirroredServerDiscovery {
  agents: MirroredAgentsDiscovery | null;
  terminal: TerminalDiscovery | null;
  ssh: SshDiscovery | null;
  /** The transports it advertised; absent from a gateway that predates them. */
  transports?: TransportsDiscovery;
  /** When the answer was taken, so a reader can say how old it is. */
  observedAtMs: number;
}

export const AGENTS_MIRROR_STORAGE_VERSION = 1;

/**
 * The mirror's document: every server's last discovery, the reader's agent
 * pick per server, and the agent each server last created a session on.
 */
export interface AgentsMirrorIndex {
  version: typeof AGENTS_MIRROR_STORAGE_VERSION;
  servers: Record<string, MirroredServerDiscovery>;
  selected: Record<string, string>;
  lastUsed: Record<string, string>;
}

/** Same cap as the capability mirror, for the same reason: a bounded store. */
export const MAX_MIRRORED_DISCOVERY_SERVERS = 24;

export function emptyAgentsMirror(): AgentsMirrorIndex {
  return { version: AGENTS_MIRROR_STORAGE_VERSION, servers: {}, selected: {}, lastUsed: {} };
}

/** A discovery answer reduced to what the mirror keeps. */
export function mirrorAgent(info: AgentInfo): MirroredAgent {
  return {
    id: info.id,
    kind: info.kind,
    name: info.name,
    status: info.status,
    enabled: info.enabled,
    features: info.features,
  };
}

export function mirrorDiscovery(
  discovery: GatewayDiscovery,
  observedAtMs: number
): MirroredServerDiscovery {
  return {
    agents: discovery.agents
      ? { ...discovery.agents, agents: discovery.agents.agents.map(mirrorAgent) }
      : null,
    terminal: discovery.terminal,
    ssh: discovery.ssh,
    ...(discovery.transports ? { transports: discovery.transports } : {}),
    observedAtMs,
  };
}

/**
 * The index with one more server's answer in it, kept under the cap by write
 * order -- the server that answered longest ago is the one that goes.
 */
export function withMirroredDiscovery(
  index: AgentsMirrorIndex,
  serverId: string,
  discovery: MirroredServerDiscovery
): AgentsMirrorIndex {
  const { [serverId]: _replaced, ...rest } = index.servers;
  const entries = Object.entries(rest);
  const kept = entries.slice(Math.max(0, entries.length - (MAX_MIRRORED_DISCOVERY_SERVERS - 1)));
  return { ...index, servers: { ...Object.fromEntries(kept), [serverId]: discovery } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMirroredAgent(value: unknown): MirroredAgent | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && value.id ? value.id : null;
  if (!id) return null;
  const kind = typeof value.kind === 'string' && value.kind ? value.kind : id;
  return {
    id,
    kind,
    name: typeof value.name === 'string' && value.name ? value.name : id,
    status: parseAgentAvailability(value.status),
    enabled: value.enabled !== false,
    features: parseAgentFeatures(value.features),
  };
}

function parseMirroredAgentsDiscovery(value: unknown): MirroredAgentsDiscovery | null {
  if (!isRecord(value) || !Array.isArray(value.agents)) return null;
  const agents: MirroredAgent[] = [];
  const seen = new Set<string>();
  for (const entry of value.agents) {
    const agent = parseMirroredAgent(entry);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    agents.push(agent);
  }
  return {
    supported: value.supported === true,
    agents,
    multiAgent: value.multiAgent === true,
    catalogAggregation: value.catalogAggregation === true,
    sessionRouting: value.sessionRouting === true,
  };
}

function parseMirroredTerminal(value: unknown): TerminalDiscovery | null {
  if (!isRecord(value) || !Array.isArray(value.backends)) return null;
  const backends = value.backends.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.sessionId !== 'string' || !entry.sessionId) return [];
    const keyboard = parseKeyboardVocabulary(entry.keyboard);
    return [
      {
        sessionId: entry.sessionId,
        label: typeof entry.label === 'string' ? entry.label : entry.sessionId,
        kind: typeof entry.kind === 'string' ? entry.kind : '',
        connected: entry.connected === true,
        capabilities: Array.isArray(entry.capabilities)
          ? entry.capabilities.filter((c): c is string => typeof c === 'string')
          : [],
        ...(keyboard ? { keyboard } : {}),
      },
    ];
  });
  return {
    supported: value.supported === true,
    mode: typeof value.mode === 'string' ? value.mode : '',
    ...(typeof value.activeBackend === 'string' && value.activeBackend
      ? { activeBackend: value.activeBackend }
      : {}),
    backends,
    ...(typeof value.degradedReason === 'string' && value.degradedReason
      ? { degradedReason: value.degradedReason }
      : {}),
  };
}

function parseMirroredSsh(value: unknown): SshDiscovery | null {
  if (!isRecord(value)) return null;
  return {
    supported: value.supported === true,
    tunnelSupported: value.tunnelSupported === true,
    pushTokenSupported: value.pushTokenSupported === true,
  };
}

function parseMirroredServer(value: unknown): MirroredServerDiscovery | null {
  if (!isRecord(value)) return null;
  const observedAtMs =
    typeof value.observedAtMs === 'number' && Number.isFinite(value.observedAtMs)
      ? value.observedAtMs
      : 0;
  const agents = parseMirroredAgentsDiscovery(value.agents);
  const terminal = parseMirroredTerminal(value.terminal);
  const ssh = parseMirroredSsh(value.ssh);
  if (!agents && !terminal && !ssh) return null;
  const transports = parseTransportsDiscovery(value.transports);
  return { agents, terminal, ssh, ...(transports ? { transports } : {}), observedAtMs };
}

function parseIdMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [serverId, agentId] of Object.entries(value)) {
    if (!serverId || typeof agentId !== 'string' || !agentId.trim()) continue;
    out[serverId] = normalizeAgentId(agentId);
  }
  return out;
}

/**
 * The mirror as stored, or empty for anything this build cannot read. A
 * document from a newer version is not this version's to interpret; it is
 * dropped in memory and overwritten on the next answer, which is the same
 * outcome as never having had one.
 */
export function parseAgentsMirrorIndex(value: string | null | undefined): AgentsMirrorIndex {
  if (!value) return emptyAgentsMirror();
  try {
    const decoded: unknown = JSON.parse(value);
    if (!isRecord(decoded) || decoded.version !== AGENTS_MIRROR_STORAGE_VERSION) {
      return emptyAgentsMirror();
    }
    const servers: Record<string, MirroredServerDiscovery> = {};
    if (isRecord(decoded.servers)) {
      for (const [serverId, entry] of Object.entries(decoded.servers)) {
        if (!serverId) continue;
        const server = parseMirroredServer(entry);
        if (server) servers[serverId] = server;
      }
    }
    return {
      version: AGENTS_MIRROR_STORAGE_VERSION,
      servers,
      selected: parseIdMap(decoded.selected),
      lastUsed: parseIdMap(decoded.lastUsed),
    };
  } catch {
    return emptyAgentsMirror();
  }
}

export function serializeAgentsMirrorIndex(index: AgentsMirrorIndex): string {
  return JSON.stringify({
    version: AGENTS_MIRROR_STORAGE_VERSION,
    servers: index.servers,
    selected: index.selected,
    lastUsed: index.lastUsed,
  });
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** One agent as a Home row will want it: the mirror's entry plus its readiness. */
export type HomeAgentEntry = MirroredAgent & { readiness: AgentReadinessStatus };

/**
 * The agents of one server, in the gateway's order, each with what Home should
 * say about it. Empty for a server that has never answered discovery, which is
 * the same rule the capability mirror keeps: nothing is offered until the
 * server has been asked.
 *
 * Referentially stable while the mirrored list is unchanged, because it is a
 * zustand selector: a new array per call never lets the store's snapshot
 * settle, and every subscriber loops until React gives up.
 */
export function selectHomeAgents(index: AgentsMirrorIndex, serverId: string): HomeAgentEntry[] {
  const agents = index.servers[serverId]?.agents?.agents;
  if (!agents) return NO_HOME_AGENTS;
  let entries = HOME_AGENTS_BY_LIST.get(agents);
  if (!entries) {
    entries = agents.map((agent) => ({ ...agent, readiness: agentReadiness(agent) }));
    HOME_AGENTS_BY_LIST.set(agents, entries);
  }
  return entries;
}

const NO_HOME_AGENTS: HomeAgentEntry[] = [];
const HOME_AGENTS_BY_LIST = new WeakMap<readonly MirroredAgent[], HomeAgentEntry[]>();

/** The agent the server last created a session on, or nothing. */
export function lastUsedAgent(index: AgentsMirrorIndex, serverId: string): string | undefined {
  return index.lastUsed[serverId];
}

/** The agent a new session on `serverId` goes to; see `resolveSelectedAgent`. */
export function selectedAgentFor(index: AgentsMirrorIndex, serverId: string): string {
  const discovery = index.servers[serverId]?.agents ?? null;
  return resolveSelectedAgent(index.selected[serverId] ?? index.lastUsed[serverId], discovery);
}

/** Whether this server has said it drives more than one ready agent. */
export function serverOffersAgentChoice(index: AgentsMirrorIndex, serverId: string): boolean {
  return offersAgentChoice(index.servers[serverId]?.agents);
}

export type { AgentAvailability, AgentFeatures, AgentInfo };
