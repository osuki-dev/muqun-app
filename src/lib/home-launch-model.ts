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

/** What an agent tile says under its name; state is never colour alone. */
export type LaunchAgentCaption =
  | 'new-session'
  | 'not-installed'
  | 'needs-setup'
  | 'needs-update'
  | 'offline';

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
};

/** The agent that owned Home before agents were listed. */
const FALLBACK_AGENT = { id: 'opencode', kind: 'opencode', name: 'OpenCode' } as const;

/** The testID an agent tile carries. */
export function launchAgentTestID(agentId: string): string {
  return `home-new-agent-${agentId}`;
}

/**
 * The agents Home offers a tile for: everything discovery lists except an
 * agent switched off (a choice made on the host, not a fault). One that still
 * needs setup keeps its tile, which opens the guide, in the gateway's own order with the last-used agent first.
 *
 * Every offered agent gets a tile; no separate overflow picker hides entries.
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
  switch (agent.readiness) {
    case 'ready':
      return 'new-session';
    case 'not-installed':
    case 'needs-setup':
    case 'needs-update':
      return agent.readiness;
    default:
      return 'offline';
  }
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
 * In order: one tile per offered agent (the first primary-filled, with
 * full visibility); Sessions; Terminal and New
 * terminal; SSH. Markers are numbered after the row is known.
 */
export function buildLaunchModel(input: LaunchModelInput = {}): LaunchModel {
  const { discovery, lastUsedAgentId } = input;
  const plane = discovery?.agents;
  // Without an agents plane, or with one that names nobody, discovery has
  // nothing to project and the fixed row stands.
  if (!discovery || !plane || plane.agents.length === 0) return fallbackModel();

  const agents = projectLaunchAgents(discovery, lastUsedAgentId);
  const drafts: Draft[] = agents.map((agent, index) => ({
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
  codex: 'Codex',
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

export const LAUNCH_GRID_GAP = 8;

/**
 * Phone mosaic only. The Pad grid keeps `LAUNCH_GRID_GAP`; these two chips
 * share a column, so the same 8-point gap reads as a slot of beach between
 * them and again beside the next column.
 */
export const LAUNCH_MOSAIC_GAP = 3;

/** Wide enough for an icon and a name; a landscape phone must not stretch the chip. */
export const LAUNCH_MOSAIC_COLUMN_MIN = 126;
export const LAUNCH_MOSAIC_COLUMN_MAX = 136;

export type LaunchMosaicCell = { indices: number[]; width: number; featured: boolean };
export type LaunchRowLayout = {
  mode: 'scroll' | 'grid';
  agentRows: LaunchMosaicCell[][];
  utilityWidth: number;
};

/**
 * The style that pins a tile to one grid cell.
 *
 * Every size is spelled out, and `flex` is reset, because a compact tile's own
 * style carries `flex: 1` -- and in Yoga a positive `flex` implies a zero flex
 * basis that `flexBasis: 'auto'` does not undo. With `'auto'` the width below
 * was ignored along the row, the tiles shrank to nothing and their labels
 * wrapped one letter per line into tall empty strips.
 */
export function launchGridCellStyle(width: number) {
  return { flex: 0, flexGrow: 0, flexShrink: 0, flexBasis: width, width } as const;
}

function columnWidth(width: number, columns: number): number {
  if (columns <= 0) return 0;
  return Math.max(0, Math.floor((width - LAUNCH_GRID_GAP * (columns - 1)) / columns));
}

/**
 * Phones keep a horizontal strip, with consecutive agent pairs sharing a column.
 * Pad callers opt into a grid; four tiles fit once each has at least 136 points.
 * Width alone never turns a landscape phone into a tall static grid.
 */
export function launchRowLayout({
  width,
  agentCount,
  utilityCount,
  grid = false,
}: {
  width: number;
  agentCount: number;
  utilityCount: number;
  grid?: boolean;
}): LaunchRowLayout {
  const measured = Number.isFinite(width) ? Math.max(0, width) : 0;
  const agentRows: LaunchMosaicCell[][] = [];
  if (!grid) {
    // A partial next column makes the horizontal continuation visible. The
    // fraction stays under half so the next pair is obviously in view, and the
    // cap keeps a landscape phone from stretching a two-word chip.
    const width =
      measured > 0
        ? Math.min(
            measured,
            Math.max(
              LAUNCH_MOSAIC_COLUMN_MIN,
              Math.min(LAUNCH_MOSAIC_COLUMN_MAX, Math.floor(measured * 0.46))
            )
          )
        : 0;
    const cells: LaunchMosaicCell[] = [];
    for (let index = 0; index < agentCount; index += 2) {
      const paired = index + 1 < agentCount;
      cells.push({ indices: paired ? [index, index + 1] : [index], width, featured: !paired });
    }
    if (cells.length) agentRows.push(cells);
    return { mode: 'scroll', agentRows, utilityWidth: width };
  }

  const maxColumns = Math.max(
    1,
    Math.min(4, Math.floor((measured + LAUNCH_GRID_GAP) / (136 + LAUNCH_GRID_GAP)))
  );
  const columns = Math.min(agentCount, maxColumns);
  for (let index = 0; index < agentCount; index += columns) {
    const cells: LaunchMosaicCell[] = [];
    for (let offset = 0; offset < columns && index + offset < agentCount; offset++) {
      cells.push({
        indices: [index + offset],
        width: columnWidth(measured, columns),
        featured: false,
      });
    }
    agentRows.push(cells);
  }
  return {
    mode: 'grid',
    agentRows,
    utilityWidth: columnWidth(measured, Math.max(1, Math.min(utilityCount, maxColumns))),
  };
}
