/**
 * Home's launch row, as a projection of what the gateway said about itself.
 *
 * `GET /api/discovery` lists the agents a gateway drives, the terminal
 * backends it holds and whether SSH is on offer. Home draws its tiles from
 * that answer instead of from a fixed list, so a new agent reaches the row
 * with a gateway release and nothing shipped to the store. This file is the
 * whole decision -- which tiles, in which order, with which marker, and what
 * each one says -- with no React, no storage and no network behind it, so a
 * Bun test can pin it with fixtures.
 *
 * Nothing mirrored, or a gateway that does not list an agents plane, projects
 * to the five tiles Home has always had, in the order it has always had them.
 * A first run and an old gateway look unchanged.
 */

import type { HomeAgentEntry, MirroredServerDiscovery } from '@/lib/agent-discovery';
import { agentReadiness, findAgent, normalizeAgentId } from '@/lib/agent-discovery';

/** More agent tiles than this collapse into one "More agents" tile. */
export const MAX_AGENT_TILES = 3;

/** What an agent tile says under its name; state is never colour alone. */
export type LaunchAgentCaption = 'new-session' | 'not-installed' | 'offline';

type LaunchEntryBase = {
  /** Stable React key. */
  key: string;
  /** `01`..`NN`, assigned after projection. */
  marker: string;
  /**
   * `compact` tiles stack two to a cell, as Sessions and Terminal always
   * have; a `tile` stands alone.
   */
  layout: 'tile' | 'compact';
  testID: string;
};

export type LaunchEntry =
  | (LaunchEntryBase & {
      kind: 'agent';
      layout: 'tile';
      /** The lead action takes the primary fill; every other tile is a surface. */
      primary: boolean;
      /**
       * The agent this tile starts a session on. Absent on the fallback tile of
       * a gateway that was never asked, which goes to the server's own choice.
       */
      agentId?: string;
      /** `opencode` gets its brand mark; any other kind gets a generic glyph. */
      agentKind: string;
      name: string;
      caption: LaunchAgentCaption;
      /** The old testID this tile keeps answering to, for the e2e manifest. */
      aliasTestID?: string;
    })
  | (LaunchEntryBase & { kind: 'more-agents'; layout: 'tile'; hidden: number })
  | (LaunchEntryBase & { kind: 'sessions'; layout: 'compact'; aliasTestID: string })
  | (LaunchEntryBase & { kind: 'terminal'; layout: 'compact' })
  | (LaunchEntryBase & {
      kind: 'new-terminal';
      layout: 'tile';
      /** The backend's kind, named only when the gateway lists more than one. */
      backend?: string;
    })
  | (LaunchEntryBase & { kind: 'ssh'; layout: 'tile' });

export type LaunchModel = {
  entries: LaunchEntry[];
  /** Whether this came from discovery or is the fixed five. */
  source: 'discovery' | 'fallback';
};

export type LaunchModelInput = {
  /** The mirrored discovery of the chosen gateway, when it ever answered. */
  discovery?: MirroredServerDiscovery | null;
  /** The agent the gateway last created a session on. */
  lastUsedAgentId?: string;
  /**
   * Agent tiles shown before the rest collapse into "More agents". The Pad
   * grid has a row of its own for agents and shows every one.
   */
  maxAgentTiles?: number;
};

/** The agent that owned Home before agents were listed. */
const FALLBACK_AGENT = { id: 'opencode', kind: 'opencode', name: 'OpenCode' } as const;

/** The testID an agent tile carries. */
export function launchAgentTestID(agentId: string): string {
  return `home-new-agent-${agentId}`;
}

/**
 * The agents Home offers a tile for: everything discovery lists except an
 * agent switched off or never set up (those are a choice made on the host,
 * not a fault), in the gateway's own order with the last-used agent first.
 *
 * The "More agents" sheet reads the same list, so the two can never disagree
 * about what an agent is called or whether it is ready.
 */
export function projectLaunchAgents(
  discovery: MirroredServerDiscovery | null | undefined,
  lastUsedAgentId?: string
): HomeAgentEntry[] {
  const listed = discovery?.agents?.agents;
  if (!listed) return [];
  const offered = listed
    .map((agent) => ({ ...agent, readiness: agentReadiness(agent) }))
    .filter((agent) => agent.readiness !== 'unsupported');
  const last = lastUsedAgentId ? offered.findIndex((agent) => agent.id === lastUsedAgentId) : -1;
  if (last <= 0) return offered;
  return [offered[last]!, ...offered.slice(0, last), ...offered.slice(last + 1)];
}

export function launchAgentCaption(agent: HomeAgentEntry): LaunchAgentCaption {
  return agent.readiness === 'not-installed'
    ? 'not-installed'
    : agent.readiness === 'ready'
      ? 'new-session'
      : 'offline';
}

/** The backend kind to name on the terminal tile, or nothing when there is no choice. */
function terminalBackendName(discovery: MirroredServerDiscovery): string | undefined {
  const backends = discovery.terminal?.backends ?? [];
  const kinds = new Set(backends.map((backend) => backend.kind).filter(Boolean));
  if (kinds.size < 2) return undefined;
  const active =
    backends.find((backend) => backend.sessionId === discovery.terminal?.activeBackend) ??
    backends.find((backend) => backend.connected) ??
    backends[0];
  return active?.kind || undefined;
}

type Draft = {
  [K in LaunchEntry['kind']]: Omit<Extract<LaunchEntry, { kind: K }>, 'marker'>;
}[LaunchEntry['kind']];

function withMarkers(drafts: Draft[]): LaunchEntry[] {
  return drafts.map(
    (draft, index) =>
      ({ ...draft, marker: String(index + 1).padStart(2, '0') }) as unknown as LaunchEntry
  );
}

function sessionsDraft(): Draft {
  return {
    key: 'sessions',
    kind: 'sessions',
    layout: 'compact',
    testID: 'home-open-sessions',
    aliasTestID: 'home-open-opencode',
  };
}

function terminalDrafts(backend?: string): Draft[] {
  return [
    { key: 'terminal', kind: 'terminal', layout: 'compact', testID: 'home-open-terminal' },
    {
      key: 'new-terminal',
      kind: 'new-terminal',
      layout: 'tile',
      testID: 'home-new-terminal',
      ...(backend ? { backend } : {}),
    },
  ];
}

const SSH_DRAFT: Draft = { key: 'ssh', kind: 'ssh', layout: 'tile', testID: 'home-open-ssh' };

function fallbackModel(): LaunchModel {
  return {
    source: 'fallback',
    entries: withMarkers([
      {
        key: `agent:${FALLBACK_AGENT.id}`,
        kind: 'agent',
        layout: 'tile',
        testID: launchAgentTestID(FALLBACK_AGENT.id),
        aliasTestID: 'home-new-opencode',
        primary: true,
        agentKind: FALLBACK_AGENT.kind,
        name: FALLBACK_AGENT.name,
        caption: 'new-session',
      },
      sessionsDraft(),
      ...terminalDrafts(),
      SSH_DRAFT,
    ]),
  };
}

/**
 * The launch row for one gateway.
 *
 * In order: one primary tile per offered agent (the first primary-filled, at
 * most three, the rest behind "More agents"); Sessions; Terminal and New
 * terminal; SSH. Markers are numbered after the row is known.
 */
export function buildLaunchModel(input: LaunchModelInput = {}): LaunchModel {
  const { discovery, lastUsedAgentId, maxAgentTiles = MAX_AGENT_TILES } = input;
  const plane = discovery?.agents;
  // Without an agents plane, or with one that names nobody, discovery has
  // nothing to project and the fixed row stands.
  if (!discovery || !plane || plane.agents.length === 0) return fallbackModel();

  const agents = projectLaunchAgents(discovery, lastUsedAgentId);
  const shown = agents.length > maxAgentTiles ? agents.slice(0, maxAgentTiles) : agents;
  const drafts: Draft[] = shown.map((agent, index) => ({
    key: `agent:${agent.id}`,
    kind: 'agent',
    layout: 'tile',
    testID: launchAgentTestID(agent.id),
    ...(agent.kind === 'opencode' ? { aliasTestID: 'home-new-opencode' } : {}),
    primary: index === 0,
    agentId: agent.id,
    agentKind: agent.kind,
    name: agent.name,
    caption: launchAgentCaption(agent),
  }));
  if (agents.length > maxAgentTiles) {
    drafts.push({
      key: 'more-agents',
      kind: 'more-agents',
      layout: 'tile',
      testID: 'home-more-agents',
      hidden: agents.length - maxAgentTiles,
    });
  }
  // A session list with no agent behind it would open an empty screen.
  if (agents.length > 0) drafts.push(sessionsDraft());
  // A gateway that says its terminal plane is unsupported has no terminal to
  // open; a gateway that did not say keeps both terminal tiles.
  if (!discovery.terminal || discovery.terminal.supported) {
    drafts.push(...terminalDrafts(terminalBackendName(discovery)));
  }
  drafts.push(SSH_DRAFT);
  return { source: 'discovery', entries: withMarkers(drafts) };
}

/** Brand casing for the agents this build knows, for when nobody has said. */
const KNOWN_AGENT_NAMES: Readonly<Record<string, string>> = {
  opencode: 'OpenCode',
  deepseek: 'DeepSeek',
  t3: 'T3 Code',
};

/**
 * What to call an agent on Home: the name the gateway gave it, or -- for a
 * server never asked, or an agent it no longer lists -- the brand's own
 * spelling if this build knows it, else the id with its first letter raised.
 */
export function agentDisplayName(
  agents: readonly Pick<HomeAgentEntry, 'id' | 'kind' | 'name'>[] | undefined,
  agentId: string | undefined | null
): string {
  const id = normalizeAgentId(agentId);
  const found = findAgent(agents, id);
  if (found?.name) return found.name;
  const known = KNOWN_AGENT_NAMES[id];
  if (known) return known;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Consecutive `compact` entries share one stacked cell; everything else stands alone. */
export type LaunchCell = { key: string; entries: LaunchEntry[] };

export function groupLaunchCells(entries: readonly LaunchEntry[]): LaunchCell[] {
  const cells: LaunchCell[] = [];
  for (const entry of entries) {
    const previous = cells[cells.length - 1];
    if (entry.layout === 'compact' && previous?.entries[0]?.layout === 'compact') {
      previous.entries.push(entry);
    } else {
      cells.push({ key: entry.key, entries: [entry] });
    }
  }
  return cells;
}

/** Under this measured width the phone row scrolls sideways; above it, it wraps. */
export const LAUNCH_SCROLL_MAX_WIDTH = 560;
/** The Pad grid takes a fourth column from this content width. */
export const LAUNCH_GRID_FOUR_COLUMN_MIN_WIDTH = 640;
export const LAUNCH_GRID_GAP = 8;

export type LaunchRowLayout =
  | { mode: 'scroll' }
  | { mode: 'wrap' }
  | {
      mode: 'grid';
      /** 3 or 4, from the content width. */
      columns: number;
      /** Agents share a row of their own: as many columns as there are agents, up to `columns`. */
      agentColumns: number;
      agentWidth: number;
      /** The four utilities sit in one row of four, or two rows of two. */
      utilityColumns: number;
      utilityWidth: number;
    };

function columnWidth(width: number, columns: number): number {
  if (columns <= 0) return 0;
  return Math.max(0, Math.floor((width - LAUNCH_GRID_GAP * (columns - 1)) / columns));
}

/**
 * How the launch row is laid out.
 *
 * The phone keeps its row exactly as it was: a sideways scroller under 560pt
 * and a wrapping row above it. The Pad's embedded Home asks for `grid` and
 * never scrolls sideways, however many agents the gateway lists: agents take
 * the first row (or rows), and Sessions, Terminal, New terminal and SSH sit
 * under them as compact tiles.
 */
export function launchRowLayout({
  width,
  grid,
  agentCount,
  utilityCount,
}: {
  width: number;
  grid: boolean;
  agentCount: number;
  utilityCount: number;
}): LaunchRowLayout {
  const measured = Number.isFinite(width) ? Math.max(0, width) : 0;
  if (!grid) return measured < LAUNCH_SCROLL_MAX_WIDTH ? { mode: 'scroll' } : { mode: 'wrap' };
  const columns = measured >= LAUNCH_GRID_FOUR_COLUMN_MIN_WIDTH ? 4 : 3;
  const agentColumns = Math.max(1, Math.min(agentCount, columns));
  const utilityColumns = Math.max(1, Math.min(utilityCount, columns === 4 ? 4 : 2));
  return {
    mode: 'grid',
    columns,
    agentColumns,
    agentWidth: columnWidth(measured, agentColumns),
    utilityColumns,
    utilityWidth: columnWidth(measured, utilityColumns),
  };
}
