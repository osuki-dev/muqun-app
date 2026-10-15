import { expect, test } from 'bun:test';
import {
  homeContinueEntries,
  homeContinueObservationNow,
  supersededTerminalRecent,
  type HomeContinueEntry,
} from '../home-continue';
import { homeServerModel } from '../home-server-model';
import type { HomeRecentEntry } from '../home-recents';
import { MAX_SERVER_AGENTS, type ServerAgentsIndex } from '../server-agents';

const snapshots: ServerAgentsIndex = {
  a: {
    serverId: 'a',
    checkedAtMs: 1,
    agents: [
      { id: 'agent', paneId: 'p1', name: 'Current agent title', hasAgent: true, status: 'idle' },
      { id: 'p2', paneId: 'p2', name: 'Shell', hasAgent: false, status: 'idle' },
    ],
  },
};
const history: HomeRecentEntry = {
  key: 'old',
  title: 'Old name',
  atMs: 20,
  target: { kind: 'gateway-terminal', serverId: 'a', sessionId: 'routing', paneId: 'p2' },
};
const input = {
  serverIds: ['a'],
  hostIds: [],
  snapshots,
  recents: [],
  reachabilityByServer: { a: 'unknown' as const },
  paneMode: 'all' as const,
};

/** What the first row's meta line says about its observation at `nowMs`. */
function shownAt(rows: HomeContinueEntry[], nowMs: number, confirmedAtMs = 0) {
  const observation = rows[0]?.observation;
  return observation && homeContinueObservationNow(observation, confirmedAtMs, nowMs);
}

test('first Home visit shows the same pane inventory as Classic without recent history', () => {
  const rows = homeContinueEntries(input);
  const classic = homeServerModel({
    serverId: 'a',
    snapshot: snapshots.a,
    reachability: 'unknown',
    paneMode: 'all',
    nowMs: 100,
  });
  expect(rows.map((row) => row.key)).toEqual(classic.rows.map((row) => row.key));
  expect(rows.map((row) => row.title)).toEqual(['Current agent title', 'Shell']);
  expect(rows[0].destination).toEqual({
    type: 'pane',
    serverId: 'a',
    paneId: 'p1',
    cwd: undefined,
  });
  expect(shownAt(rows, 100)).toEqual({
    kind: 'gateway-agent',
    status: 'idle',
    age: { unit: 'now', value: 0 },
    stale: false,
  });
});

test('entry-only computer cards retain Continue inventory; optional shortcut suppression stays scoped', () => {
  const recent = (key: string, target: HomeRecentEntry['target']): HomeRecentEntry => ({
    key,
    title: 'Same title',
    atMs: 20,
    target,
  });
  const currentPane = recent('current', {
    kind: 'gateway-terminal',
    serverId: 'a',
    sessionId: 'routing',
    paneId: 'p1',
  });
  const otherSession = recent('other-session', {
    kind: 'gateway-terminal',
    serverId: 'a',
    sessionId: 'other',
    paneId: 'p1',
  });
  const filteredPane = recent('plain-shell', {
    kind: 'gateway-terminal',
    serverId: 'a',
    sessionId: 'routing',
    paneId: 'p2',
  });
  const structured = recent('structured', {
    kind: 'agent-session',
    serverId: 'a',
    sessionId: 'routing',
    asid: 'conversation',
    directory: '/work',
  });
  const ssh = recent('ssh', { kind: 'ssh-host', hostId: 'host' });
  const shared = {
    ...input,
    paneMode: 'agents' as const,
    hostIds: ['host'],
    snapshots: { a: { ...snapshots.a!, sessionId: 'routing' } },
    recents: [currentPane, otherSession, filteredPane, structured, ssh],
  };
  const classic = homeContinueEntries({ ...shared, connectionShortcutsElsewhere: true });
  expect(classic.map((entry) => entry.key)).toEqual(['structured', 'other-session', 'plain-shell']);
  expect(classic.map((entry) => entry.destination)).toEqual(
    [structured, otherSession, filteredPane].map((entry) => ({
      type: 'recent',
      target: entry.target,
    }))
  );
  const editorial = homeContinueEntries(shared);
  expect(editorial.some((entry) => entry.destination.type === 'pane')).toBe(true);
  expect(editorial.some((entry) => entry.key === 'ssh')).toBe(true);
  // Classic now uses this same unsuppressed inventory: its computer cards
  // navigate to workspaces instead of rendering a second pane list.
  expect(editorial[0]?.key).toBe('structured');
  expect(
    editorial.flatMap((entry) =>
      entry.destination.type === 'pane' ? [entry.destination.paneId] : []
    )
  ).toEqual(['p1']);
  expect(
    editorial.filter((entry) => entry.destination.type === 'recent').map((entry) => entry.key)
  ).toEqual(['structured', 'other-session', 'plain-shell', 'ssh']);
  const allPanes = homeContinueEntries({ ...shared, paneMode: 'all' });
  expect(
    allPanes.flatMap((entry) =>
      entry.destination.type === 'pane' ? [entry.destination.paneId] : []
    )
  ).toEqual(['p1', 'p2']);
  expect(allPanes.some((entry) => entry.key === 'plain-shell')).toBe(false);
});

test('Classic keeps a terminal recent when no connection pane inventory can replace it', () => {
  const rows = homeContinueEntries({
    ...input,
    snapshots: {},
    recents: [history],
    connectionShortcutsElsewhere: true,
  });
  expect(rows.map((entry) => entry.key)).toEqual(['old']);
});

test('Terminal metadata uses the structured gateway agent label and never guesses from a title', () => {
  const rows = homeContinueEntries({
    ...input,
    snapshots: {
      a: {
        ...snapshots.a,
        agents: [
          {
            id: 'known',
            paneId: 'known-pane',
            name: 'Release notes',
            agentLabel: 'Claude Code',
            hasAgent: true,
            status: 'idle',
          },
          {
            id: 'unknown',
            paneId: 'unknown-pane',
            name: 'Codex-looking title',
            hasAgent: true,
            status: 'idle',
          },
        ],
      },
    },
  });

  expect(rows.find((row) => row.title === 'Release notes')?.agentLabel).toBe('Claude Code');
  expect(rows.find((row) => row.title === 'Codex-looking title')?.agentLabel).toBeUndefined();
});

test('OpenCode recents show only current Gateway observations and keep honest age', () => {
  const recent: HomeRecentEntry = {
    key: 'opencode',
    title: 'Build release',
    atMs: 20,
    target: {
      kind: 'agent-session',
      serverId: 'a',
      sessionId: 'routing',
      directory: '/workspace',
      asid: 'root',
    },
    sessionObservation: { status: 'busy', observedAtMs: 10_000 },
  };
  const rows = homeContinueEntries({ ...input, snapshots: {}, recents: [recent] });
  expect(shownAt(rows, 70_000)).toEqual({
    kind: 'agent-session',
    status: 'busy',
    age: { unit: 'now', value: 0 },
    stale: false,
  });

  expect(
    homeContinueEntries({
      ...input,
      snapshots: {},
      recents: [recent],
      reachabilityByServer: { a: 'offline' },
    })
  ).toEqual([]);

  const stale = shownAt(rows, 400_001);
  expect(stale).toMatchObject({
    kind: 'agent-session',
    age: { unit: 'minute', value: 6 },
    stale: true,
  });
  expect(stale?.status).toBeUndefined();
  // A pass that found the same status again keeps it current without a rebuild.
  expect(shownAt(rows, 400_001, 390_000)).toMatchObject({ status: 'busy', stale: false });
});

test('history changes ranking without duplicating panes or replacing authoritative names', () => {
  const rows = homeContinueEntries({ ...input, recents: [history] });
  expect(rows.map((row) => row.title)).toEqual(['Shell', 'Current agent title']);
  expect(rows).toHaveLength(2);
  expect(history.title).toBe('Old name');
});

test('authoritative deletion wins over pane history', () => {
  expect(
    homeContinueEntries({
      ...input,
      snapshots: { a: { ...snapshots.a, agents: [] } },
      recents: [history],
    })
  ).toEqual([]);
});

test('missing snapshots retain exact recent targets and unpaired servers never appear', () => {
  expect(
    homeContinueEntries({ ...input, snapshots: {}, recents: [history] })[0].destination
  ).toEqual({ type: 'recent', target: history.target });
  expect(homeContinueEntries({ ...input, serverIds: [], recents: [history] })).toEqual([]);
});

test('one server cannot supply another server panes', () => {
  expect(
    homeContinueEntries({ ...input, snapshots: { a: { ...snapshots.a, serverId: 'b' } } })
  ).toEqual([]);
});

test('Continue hides every gateway-owned entry while its gateway is offline', () => {
  const blocked = {
    ...input,
    snapshots: {
      a: {
        ...snapshots.a,
        agents: [
          {
            id: 'agent',
            paneId: 'p1',
            name: 'Needs approval',
            hasAgent: true,
            status: 'blocked' as const,
          },
        ],
      },
    },
  };

  expect(shownAt(homeContinueEntries(blocked), 100)?.status).toBe('blocked');
  expect(homeContinueEntries({ ...blocked, reachabilityByServer: { a: 'offline' } })).toEqual([]);
  expect(shownAt(homeContinueEntries(blocked), 1_000_000)?.status).toBeUndefined();
});

test('offline filtering is gateway-scoped, retains unknown and SSH entries, and recovers', () => {
  const offlineOpenCode: HomeRecentEntry = {
    key: 'offline-opencode',
    title: 'Offline OpenCode',
    atMs: 50,
    target: {
      kind: 'agent-session',
      serverId: 'c',
      sessionId: 'routing',
      directory: '/workspace',
      asid: 'root',
    },
  };
  const offlineHistory: HomeRecentEntry = {
    key: 'offline-history',
    title: 'Offline terminal',
    atMs: 40,
    target: { kind: 'gateway-terminal', serverId: 'c', sessionId: 'routing', paneId: 'old' },
  };
  const liveHistory: HomeRecentEntry = {
    key: 'live-history',
    title: 'Live terminal',
    atMs: 30,
    target: { kind: 'gateway-terminal', serverId: 'b', sessionId: 'routing', paneId: 'live' },
  };
  const ssh: HomeRecentEntry = {
    key: 'ssh',
    title: 'Standalone SSH',
    atMs: 20,
    target: { kind: 'ssh-host', hostId: 'host' },
  };
  const multiGatewayInput = {
    ...input,
    serverIds: ['a', 'b', 'c'],
    hostIds: ['host'],
    snapshots: {
      a: snapshots.a,
      b: {
        serverId: 'b',
        checkedAtMs: 1,
        agents: [
          { id: 'live', paneId: 'live', name: 'Live agent', hasAgent: true, status: 'idle' },
        ],
      },
    } satisfies ServerAgentsIndex,
    recents: [offlineOpenCode, offlineHistory, liveHistory, ssh],
  };

  const offlineRows = homeContinueEntries({
    ...multiGatewayInput,
    reachabilityByServer: { a: 'offline', b: 'live', c: 'offline' },
  });
  expect(offlineRows.map((row) => row.title)).toEqual(['Live agent', 'Standalone SSH']);
  expect(
    offlineRows.some(
      (row) =>
        row.destination.type === 'recent' && row.destination.target === offlineOpenCode.target
    )
  ).toBe(false);
  expect(
    offlineRows.some(
      (row) => row.destination.type === 'recent' && row.destination.target === offlineHistory.target
    )
  ).toBe(false);

  const recoveredRows = homeContinueEntries({
    ...multiGatewayInput,
    reachabilityByServer: { a: 'unknown', b: 'live' },
  });
  expect(recoveredRows.map((row) => row.title)).toEqual([
    'Offline OpenCode',
    'Offline terminal',
    'Live agent',
    'Standalone SSH',
    'Current agent title',
    'Shell',
  ]);
});

test('plain panes and history-only entries never receive agent status', () => {
  const paneRows = homeContinueEntries(input);
  expect(paneRows[1]?.observation).toBeUndefined();
  expect(
    homeContinueEntries({ ...input, snapshots: {}, recents: [history] })[0]?.observation
  ).toBeUndefined();
});

const T = 1_700_000_000_000;
const terminalVisit: HomeRecentEntry = {
  key: 'visit',
  title: 'zsh',
  atMs: T,
  target: { kind: 'gateway-terminal', serverId: 'a', sessionId: 'routing', paneId: 'p2' },
};
function gatewayAgent(asid: string, updatedMs: number) {
  return {
    asid,
    agentId: 'opencode',
    title: `${asid} task`,
    directory: '/w',
    status: 'idle' as const,
    updatedMs,
  };
}
const rankingInput = {
  ...input,
  snapshots: { a: { ...snapshots.a, sessionId: 'routing', checkedAtMs: T } },
  gatewaySessions: {
    serverId: 'a',
    sessionId: 'routing',
    observedAtMs: T,
    sessions: [gatewayAgent('newer', T + 1_000), gatewayAgent('older', T - 1_000)],
  },
};

test('agent sessions precede a terminal visited between their update times', () => {
  const rows = homeContinueEntries({ ...rankingInput, recents: [terminalVisit] });
  expect(rows.map((row) => row.title)).toEqual([
    'newer task',
    'older task',
    'Shell',
    'Current agent title',
  ]);
  expect(rows.map((row) => row.atMs)).toEqual([T + 1_000, T - 1_000, T, 0]);
});

test('a terminal with neither a visit nor activity ranks last', () => {
  const rows = homeContinueEntries(rankingInput);
  expect(rows.at(-1)?.atMs).toBe(0);
  expect(rows.slice(0, 2).map((row) => row.title)).toEqual(['newer task', 'older task']);
});

test('a visited plain terminal survives the agents-only pane filter', () => {
  const rows = homeContinueEntries({
    ...rankingInput,
    paneMode: 'agents',
    recents: [terminalVisit],
  });
  expect(rows.map((row) => row.title)).toEqual([
    'newer task',
    'older task',
    'zsh',
    'Current agent title',
  ]);
  expect(rows[2]?.destination).toEqual({ type: 'recent', target: terminalVisit.target });
  // Unvisited plain panes still follow the filter.
  expect(
    homeContinueEntries({ ...rankingInput, paneMode: 'agents' }).some(
      (row) => row.title === 'Shell'
    )
  ).toBe(false);
});

test('a recent for a pane in another Herdr session than the snapshot is kept', () => {
  const elsewhere: HomeRecentEntry = {
    ...terminalVisit,
    key: 'elsewhere',
    title: 'Other session shell',
    target: { kind: 'gateway-terminal', serverId: 'a', sessionId: 'other', paneId: 'gone' },
  };
  const rows = homeContinueEntries({
    ...input,
    snapshots: rankingInput.snapshots,
    recents: [elsewhere],
  });
  expect(rows.map((row) => row.title)).toContain('Other session shell');
  // The same pane id in the snapshot's own session is a closed pane and is dropped.
  const closed = { ...elsewhere, target: { ...elsewhere.target, sessionId: 'routing' } };
  expect(
    homeContinueEntries({ ...input, snapshots: rankingInput.snapshots, recents: [closed] }).map(
      (row) => row.title
    )
  ).not.toContain('Other session shell');
});

test('supersededTerminalRecent keeps the old filter for a snapshot without a session', () => {
  const legacy = { ...snapshots.a, sessionId: undefined };
  const shell = {
    kind: 'gateway-terminal' as const,
    serverId: 'a',
    sessionId: 'any',
    paneId: 'p2',
  };
  expect(supersededTerminalRecent(shell, legacy, 'agents')).toBe(true);
});

test('supersededTerminalRecent drops a recent whose pane is already a snapshot row', () => {
  const session = { ...snapshots.a, sessionId: 'routing' };
  const shell = {
    kind: 'gateway-terminal' as const,
    serverId: 'a',
    sessionId: 'routing',
    paneId: 'p2',
  };
  expect(supersededTerminalRecent(shell, session, 'all')).toBe(true);
  expect(supersededTerminalRecent(shell, session, 'agents')).toBe(false);
});

test('a recent missing from a snapshot cut at the mirror cap is kept, not taken as closed', () => {
  const panes = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `w${index}`,
      paneId: `w${index}`,
      name: `pane ${index}`,
      hasAgent: true,
      status: 'idle' as const,
    }));
  const shell = {
    kind: 'gateway-terminal' as const,
    serverId: 'a',
    sessionId: 'routing',
    paneId: 'w-newest',
  };
  const full = { ...snapshots.a, sessionId: 'routing', agents: panes(MAX_SERVER_AGENTS) };
  expect(supersededTerminalRecent(shell, full, 'all')).toBe(false);
  const partial = { ...full, agents: panes(MAX_SERVER_AGENTS - 1) };
  expect(supersededTerminalRecent(shell, partial, 'all')).toBe(true);
  const rows = homeContinueEntries({
    ...input,
    snapshots: { a: full },
    recents: [{ key: 'newest', title: 'me@desk:~/app', atMs: 50, target: shell }],
  });
  expect(rows[0]?.title).toBe('me@desk:~/app');
});
