import { expect, test } from 'bun:test';
import { homeContinueEntries } from '../home-continue';
import { homeServerModel } from '../home-server-model';
import type { HomeRecentEntry } from '../home-recents';
import type { ServerAgentsIndex } from '../server-agents';

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
  nowMs: 100,
};

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
  expect(rows[0].observation).toEqual({
    kind: 'gateway-agent',
    status: 'idle',
    age: { unit: 'now', value: 0 },
    stale: false,
  });
});

test('OpenCode recents show only current Gateway observations and keep honest age', () => {
  const recent: HomeRecentEntry = {
    key: 'opencode',
    title: 'Build release',
    atMs: 20,
    target: {
      kind: 'opencode-session',
      serverId: 'a',
      sessionId: 'routing',
      directory: '/workspace',
      asid: 'root',
    },
    sessionObservation: { status: 'busy', observedAtMs: 10_000 },
  };
  const current = homeContinueEntries({
    ...input,
    snapshots: {},
    recents: [recent],
    nowMs: 70_000,
  })[0]?.observation;
  expect(current).toEqual({
    kind: 'opencode-session',
    status: 'busy',
    age: { unit: 'now', value: 0 },
    stale: false,
  });

  const offline = homeContinueEntries({
    ...input,
    snapshots: {},
    recents: [recent],
    reachabilityByServer: { a: 'offline' },
    nowMs: 70_000,
  })[0]?.observation;
  expect(offline).toMatchObject({ kind: 'opencode-session', stale: false });
  expect(offline?.status).toBeUndefined();

  const stale = homeContinueEntries({
    ...input,
    snapshots: {},
    recents: [recent],
    nowMs: 400_001,
  })[0]?.observation;
  expect(stale).toMatchObject({
    kind: 'opencode-session',
    age: { unit: 'minute', value: 6 },
    stale: true,
  });
  expect(stale?.status).toBeUndefined();
});

test('history changes ranking without duplicating panes or replacing authoritative names', () => {
  const rows = homeContinueEntries({ ...input, recents: [history] });
  expect(rows.map((row) => row.title)).toEqual(['Shell', 'Current agent title']);
  expect(rows).toHaveLength(2);
  expect(history.title).toBe('Old name');
});

test('Classic agent filtering and authoritative deletion win over pane history', () => {
  expect(
    homeContinueEntries({ ...input, recents: [history], paneMode: 'agents' }).map(
      (row) => row.title
    )
  ).toEqual(['Current agent title']);
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

test('Continue uses the shared freshness and reachability policy for status', () => {
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

  expect(homeContinueEntries(blocked)[0]?.observation?.status).toBe('blocked');
  expect(
    homeContinueEntries({ ...blocked, reachabilityByServer: { a: 'offline' } })[0]?.observation
      ?.status
  ).toBeUndefined();
  expect(
    homeContinueEntries({ ...blocked, nowMs: 1_000_000 })[0]?.observation?.status
  ).toBeUndefined();
});

test('plain panes and history-only entries never receive agent status', () => {
  const paneRows = homeContinueEntries(input);
  expect(paneRows[1]?.observation).toBeUndefined();
  expect(
    homeContinueEntries({ ...input, snapshots: {}, recents: [history] })[0]?.observation
  ).toBeUndefined();
});
