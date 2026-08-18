import type { GatewayEntity } from '@/lib/gateway-entities';
import { asAgentStatus, field, panelTitle, type AgentStatus } from '@/lib/herdr-entity';

/**
 * What the home screen knows about the panes on a server it is not connected
 * to (card #621).
 *
 * Only one gateway connection is open at a time, so the server list cannot ask
 * the other servers what they are running -- and it must not try: each record
 * holds its own pairing token, and opening a connection per card to draw a list
 * would put every token on the wire every time the app is launched.
 *
 * So this is a mirror, not a query. The server screen writes down what it just
 * saw, the home screen reads it back, and the age travels with it so the list
 * can say "last seen" rather than pretend to be live. As with the home-screen
 * widget, the mirror carries no URL, no token, and no pane output -- only pane
 * names, agent statuses and, for a pane with no agent, its cwd.
 *
 * A tmux window and a herdr pane are the same thing on the wire, and a window
 * running an agent is not a different kind of window from one running a plain
 * shell -- `mirroredServerAgents` (agent-only) and `mirroredServerPanes` (every
 * pane) build the same `ServerAgent[]` shape from the same two lists for
 * exactly that reason: which one runs is a setting
 * (`app-settings.ts`'s `serverCardPanes`), not a fork in what a row *is*.
 *
 * The mirror always holds the full-pane shape now -- `server-terminal-workspace.tsx`
 * writes `mirroredServerPanes` unconditionally, never `mirroredServerAgents` --
 * and `serverCardPanes` is answered by filtering `agent.hasAgent` at render
 * time (`ServerAgentRows`), not by choosing which function to call when the
 * mirror is written. That used to be reversed: the write picked the shape the
 * setting asked for, so changing the setting from Settings did nothing until
 * the reader next opened a server and re-wrote the mirror in the new shape --
 * a setting that only took effect after visiting an unrelated screen. Writing
 * everything and filtering on the way out means the setting is exactly as live
 * as the store it reads, at the cost of a mirror that is, in "agents" mode,
 * larger than it needs to be -- already budgeted for, since `MAX_SERVER_AGENTS`
 * was sized for "every pane" mode regardless of which mode a given install
 * uses. `mirroredServerAgents` stays for the one caller that still wants the
 * agent-only shape outright (the Android widget, which is fed fresh from
 * `data.agents`/`data.panes` on every poll, not from this store).
 */

export type ServerAgent = {
  /** Gateway agent id, or the pane id when there is no agent to key the row on. */
  id: string;
  name: string;
  status: AgentStatus;
  /**
   * Whether this row is an agent's, as opposed to a plain pane with nothing
   * running in it. `mirroredServerAgents` only ever builds agent rows, so it
   * always sets this `true`; `mirroredServerPanes` sets it per pane, and it is
   * what lets a reader in "agents" mode filter a superset mirror down to the
   * rows that setting promises without needing a second, agent-only mirror
   * kept in step beside the first.
   *
   * Defaults to `true` when reading a snapshot written before this field
   * existed (`parseSnapshot`): every snapshot from that era came from
   * `mirroredServerAgents`, agents only, so the default is exactly what those
   * rows were. The one gap is a snapshot written by `mirroredServerPanes`
   * between that feature shipping and this field being added -- a plain
   * pane's row would read as an agent's until the next poll overwrites it,
   * which is the same "stale until the screen is next opened" a reader
   * already accepts for the rest of this mirror.
   */
  hasAgent: boolean;
  /**
   * The pane this row is running in, so tapping it on the home screen lands
   * on that pane rather than on whatever the server was last showing.
   *
   * Optional because it is not always knowable: a gateway that does not report
   * `pane_id`, and every snapshot written before this field existed, leave it
   * empty. The row is still tappable in that case -- it just opens the server.
   */
  paneId?: string;
  /**
   * Where a plain pane sits, for the reader to tell two shells apart by. An
   * agent's own title is already distinctive, so `mirroredServerAgents` never
   * sets this; `mirroredServerPanes` sets it only for a pane with no agent in
   * it, which has nothing else identifying about it besides its name and
   * where it is.
   */
  cwd?: string;
};

export type ServerAgentsSnapshot = {
  /** Local record id, the same one `/servers/[serverId]` routes on. */
  serverId: string;
  /** When the app last confirmed these statuses with the gateway. */
  checkedAtMs: number;
  agents: ServerAgent[];
};

/** Every server's latest snapshot, keyed by record id. */
export type ServerAgentsIndex = Record<string, ServerAgentsSnapshot>;

export const SERVER_AGENTS_STORAGE_KEY = 'muqun.server-agents.v1';

/**
 * Secure storage is not sized for bulk data, so the mirror is capped well
 * below anything a machine could plausibly be running. Names and paths are
 * clipped for the same reason.
 *
 * 8 when this only ever held agents; a card in "every pane" mode mirrors a
 * whole tmux session rather than a handful of agent windows -- the machine
 * this feature was built for already runs eleven panes across four windows --
 * so the ceiling moved up to match, not because more should be shown, but
 * because fewer must not silently disappear from the one mode this exists to
 * serve.
 */
export const MAX_SERVER_AGENTS = 24;
const MAX_AGENT_NAME_LENGTH = 32;
const MAX_AGENT_CWD_LENGTH = 48;

/**
 * How many servers stay mirrored. Records the user has unpaired are pruned on
 * sight, but a cap keeps a long-lived install from accumulating snapshots for
 * servers it will never show again.
 */
export const MAX_MIRRORED_SERVERS = 24;

/**
 * After this, the list stops presenting a snapshot as current. Chosen against
 * the server screen's own poll: anything it saw is refreshed within seconds of
 * the screen being open, so five minutes means "you have not looked at this
 * server recently", not "the gateway is slow".
 */
export const SERVER_AGENTS_STALE_AFTER_MS = 5 * 60 * 1000;

export function normalizeServerAgents(snapshot: ServerAgentsSnapshot): ServerAgentsSnapshot {
  return {
    serverId: snapshot.serverId,
    checkedAtMs: snapshot.checkedAtMs,
    agents: snapshot.agents.slice(0, MAX_SERVER_AGENTS).map((agent) => ({
      id: agent.id,
      name: agent.name.slice(0, MAX_AGENT_NAME_LENGTH),
      status: agent.status,
      hasAgent: agent.hasAgent,
      // Absent rather than empty: `paneId: ''` would look like a pane id that
      // resolves to nothing, and the home screen decides whether to deep-link
      // by asking whether the field is there at all.
      ...(agent.paneId ? { paneId: agent.paneId } : {}),
      ...(agent.cwd ? { cwd: agent.cwd.slice(0, MAX_AGENT_CWD_LENGTH) } : {}),
    })),
  };
}

/**
 * The agent-only list. `server-terminal-workspace.tsx` no longer writes this
 * to the mirror -- see `mirroredServerPanes` for why -- but it still feeds the
 * Android home-screen widget, which wants agents specifically and is rebuilt
 * fresh from `data.agents`/`data.panes` on every poll rather than reading the
 * mirror, so it is unaffected by which shape the mirror stores.
 *
 * The name has to be `panelTitle`, not `agent.title`, and that is the whole
 * reason this is a function. A user who renames a panel is naming *that panel*:
 * `panelTitle` lets a pane's own label beat the agent's name, which is why the
 * pane strip, the panels sheet and the Lock Screen card all show the new name
 * the moment the rename lands. The mirror used to copy `agent.title` straight
 * out of the agents endpoint, which a pane rename never touches -- so the home
 * screen went on showing whatever the agent was called when it started, for as
 * long as that agent ran.
 *
 * Panes are passed in rather than looked up by the caller because the join is
 * the part worth testing: an agent's `pane_id` is what turns its row on the
 * home screen into a deep link, and it is the same field that finds the pane
 * whose label should name it.
 */
export function mirroredServerAgents(
  agents: readonly GatewayEntity[],
  panes: readonly GatewayEntity[]
): ServerAgent[] {
  const paneById = new Map(panes.map((pane) => [pane.id, pane]));
  return agents.map((agent) => {
    const paneId = field(agent, 'pane_id');
    const pane = paneById.get(paneId);
    return {
      id: agent.id,
      name: panelTitle(pane, agent),
      status: asAgentStatus(agent.status),
      hasAgent: true,
      // What makes an agent on the home screen a link rather than a label: the
      // list has no session of its own to resolve a name against, so the pane
      // it should open has to travel with the name.
      ...(paneId ? { paneId } : {}),
    };
  });
}

/**
 * The whole-session list the server screen writes down -- every pane, not
 * only the ones running an agent. `server-terminal-workspace.tsx` writes this
 * unconditionally now, regardless of `serverCardPanes` (`app-settings.ts`):
 * the setting decides what a reader in "agents" mode gets to *see*
 * (`ServerAgentRows` filters on `hasAgent`), not what gets written down, so
 * that flipping the setting in Settings does not need a visit to a server
 * screen before the home list agrees with it.
 *
 * A tmux window/pane and a herdr tab/pane are the same concept, so this walks
 * *panes* rather than agents: every pane gets a row, an agent's if one is
 * running there, a plain one otherwise. The gateway already answers both
 * lists on every poll (`gatewayTransport.loadPanes` beside `loadAgents` in
 * `[serverId].tsx`), so this needs no request `mirroredServerAgents` was not
 * already making -- only the other half of the join it already does.
 *
 * A plain pane has no agent to name it, so it gets its own title (still
 * `panelTitle`, so a renamed pane still wins) and, since a bare "zsh" tells two
 * shells apart from nothing, its cwd -- which an agent's row leaves unset,
 * because an agent's own title is already distinctive. Its status is
 * `'unknown'`, the same grey/uncertain status idle and unrecognised agents
 * already share; there is no dedicated "no agent" status because nothing reads
 * this one as a claim about an agent at all. `hasAgent` is what a filter reads
 * instead.
 */
export function mirroredServerPanes(
  panes: readonly GatewayEntity[],
  agents: readonly GatewayEntity[]
): ServerAgent[] {
  const agentByPaneId = new Map(
    agents.flatMap((agent) => {
      const paneId = field(agent, 'pane_id');
      return paneId ? [[paneId, agent] as const] : [];
    })
  );
  return panes.map((pane) => {
    const agent = agentByPaneId.get(pane.id);
    if (agent) {
      return {
        id: agent.id,
        name: panelTitle(pane, agent),
        status: asAgentStatus(agent.status),
        hasAgent: true,
        paneId: pane.id,
      };
    }
    return {
      id: pane.id,
      name: panelTitle(pane),
      status: 'unknown' as const,
      hasAgent: false,
      paneId: pane.id,
      ...(pane.cwd ? { cwd: pane.cwd } : {}),
    };
  });
}

/**
 * Whether two snapshots say the same thing about the same server. The age is
 * deliberately not compared: a poll that found no news must not cost a keychain
 * write, and the list reads ages in minutes.
 */
export function sameServerAgents(
  previous: ServerAgentsSnapshot | undefined,
  next: ServerAgentsSnapshot
): boolean {
  if (!previous) return false;
  if (previous.serverId !== next.serverId) return false;
  if (previous.agents.length !== next.agents.length) return false;
  return previous.agents.every((agent, index) => {
    const other = next.agents[index];
    return (
      agent.id === other.id
      && agent.name === other.name
      && agent.status === other.status
      // A pane starting or losing its agent changes which mode's filter it
      // passes, so it is a change worth writing even though nothing else about
      // the row moved.
      && agent.hasAgent === other.hasAgent
      // An agent that moved to another pane is a change worth writing: the row
      // is a deep link, and a stale pane id sends the tap to the wrong panel.
      && agent.paneId === other.paneId
      // A plain pane's cwd is the only thing that ever changes about it -- `cd`
      // elsewhere in that shell -- and it is the fact the row exists to show.
      && agent.cwd === other.cwd
    );
  });
}

export function isServerAgentsStale(
  snapshot: ServerAgentsSnapshot,
  nowMs: number = Date.now()
): boolean {
  return nowMs - snapshot.checkedAtMs > SERVER_AGENTS_STALE_AFTER_MS;
}

/**
 * The age as a bucket and a count, so the screen can say it in the active
 * locale. This module is imported by its test suite and therefore cannot hold
 * a Lingui macro (see `src/i18n/labels.ts`): the domain decides how old the
 * snapshot is, the component says so.
 */
export function serverAgentsAgeParts(
  snapshot: ServerAgentsSnapshot,
  nowMs: number = Date.now()
): { unit: 'now' | 'minute' | 'hour' | 'day'; value: number } {
  const seconds = Math.max(0, Math.round((nowMs - snapshot.checkedAtMs) / 1000));
  if (seconds < 90) return { unit: 'now', value: 0 };
  if (seconds < 3600) return { unit: 'minute', value: Math.floor(seconds / 60) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

/** "just now", "4m ago", "2h ago" -- a card has room for nothing longer. */
export function serverAgentsAge(
  snapshot: ServerAgentsSnapshot,
  nowMs: number = Date.now()
): string {
  const { unit, value } = serverAgentsAgeParts(snapshot, nowMs);
  if (unit === 'now') return 'just now';
  return `${value}${unit === 'minute' ? 'm' : unit === 'hour' ? 'h' : 'd'} ago`;
}

/**
 * What "agents" mode keeps, out of a mirror that always holds every pane --
 * the other half of `mirroredServerPanes` writing unconditionally. `'all'`
 * hands the list back untouched; `'agents'` drops every row whose `hasAgent`
 * is `false`.
 *
 * A plain function rather than logic inlined in `ServerAgentRows`, for the
 * same reason the rest of this module is plain functions: it is the one part
 * of "does the setting actually take effect" worth a direct test, and a
 * component under this repo's RN/Skia stack is not unit-testable the way a
 * function is (see the module comment on `terminal-text-size.ts` for the
 * general version of that constraint).
 *
 * Takes the setting's own two values rather than a boolean so a caller
 * reading `serverCardPanes` can pass it straight through without translating
 * it first.
 */
export function visibleServerAgents(
  agents: readonly ServerAgent[],
  serverCardPanes: 'agents' | 'all'
): ServerAgent[] {
  return serverCardPanes === 'agents' ? agents.filter((agent) => agent.hasAgent) : agents.slice();
}

/**
 * The location worth showing under a pane's name, or nothing when the name has
 * already said it.
 *
 * A plain pane is usually named by its shell prompt, and a prompt very often
 * *is* the path -- `ryu@osk:~/.osuki/draw` over a cwd of
 * `/home/ryu/.osuki/draw`. Drawing both puts the same fact on the card twice
 * and makes that row half again as tall as the rows around it, which is the
 * single loudest thing left in a list once it has no connector lines holding it
 * together. The cwd still earns its line whenever it distinguishes two panes
 * whose names do not.
 *
 * The tilde is resolved by comparison rather than by expansion: the app does not
 * know the gateway's home directory, but the prompt and the cwd come from the
 * same shell on the same machine, so a cwd ending in the prompt's post-tilde
 * remainder is that same directory.
 */
export function paneLocationCaption(name: string, cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;

  const location = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
  if (!location) return undefined;
  if (name.includes(location)) return undefined;

  const tilde = name.lastIndexOf('~/');
  if (tilde >= 0 && location.endsWith(name.slice(tilde + 1))) return undefined;

  return location;
}

/**
 * Drops snapshots for servers this device no longer has, then caps what is
 * left to the most recently seen. Unpairing is the important half: a card is
 * gone but its agent names would otherwise sit in storage indefinitely.
 */
export function keepMirroredServers(
  index: ServerAgentsIndex,
  serverIds: readonly string[]
): ServerAgentsIndex {
  const known = new Set(serverIds);
  const kept = Object.values(index)
    .filter((snapshot) => known.has(snapshot.serverId))
    .sort((a, b) => b.checkedAtMs - a.checkedAtMs)
    .slice(0, MAX_MIRRORED_SERVERS);

  const next: ServerAgentsIndex = {};
  for (const snapshot of kept) next[snapshot.serverId] = snapshot;
  return next;
}

/**
 * Anything read back out of storage is untrusted input: an older build may have
 * written a different shape, and a half-parsed snapshot would render as a card
 * full of `undefined`.
 */
export function parseServerAgentsIndex(value: string): ServerAgentsIndex {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const index: ServerAgentsIndex = {};
    for (const entry of Object.values(parsed as Record<string, unknown>)) {
      const snapshot = parseSnapshot(entry);
      if (snapshot) index[snapshot.serverId] = snapshot;
    }
    return index;
  } catch {
    return {};
  }
}

function parseSnapshot(value: unknown): ServerAgentsSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.serverId !== 'string' || !record.serverId) return null;
  if (typeof record.checkedAtMs !== 'number' || !Number.isFinite(record.checkedAtMs)) return null;
  if (!Array.isArray(record.agents)) return null;

  return normalizeServerAgents({
    serverId: record.serverId,
    checkedAtMs: record.checkedAtMs,
    agents: record.agents.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const agent = item as Record<string, unknown>;
      if (typeof agent.id !== 'string' || typeof agent.name !== 'string') return [];
      return [{
        id: agent.id,
        name: agent.name,
        status: asAgentStatus(typeof agent.status === 'string' ? agent.status : undefined),
        // Missing on a snapshot written before this field existed -- see the
        // field's own doc comment on `ServerAgent` for why `true` is the
        // correct default rather than a guess.
        hasAgent: typeof agent.hasAgent === 'boolean' ? agent.hasAgent : true,
        ...(typeof agent.paneId === 'string' && agent.paneId ? { paneId: agent.paneId } : {}),
        ...(typeof agent.cwd === 'string' && agent.cwd ? { cwd: agent.cwd } : {}),
      }];
    }),
  });
}
