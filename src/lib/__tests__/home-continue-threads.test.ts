import { expect, test } from 'bun:test';

import {
  goneSessionKey,
  homeContinueEntries,
  homeContinueCommand,
  type GatewayAgentSession,
  type GatewayAgentSessionsSnapshot,
} from '../home-continue';
import type { HomeRecentEntry } from '../home-recents';
import type { HomeThreadPane, HomeThreadSession } from '../home-thread';
import type { ServerAgentsSnapshot } from '../server-agents';

const base = {
  serverIds: ['desk'],
  hostIds: [],
  snapshots: {},
  recents: [] as HomeRecentEntry[],
  reachabilityByServer: { desk: 'live' as const },
  paneMode: 'all' as const,
};

function listing(sessions: GatewayAgentSession[], observedAtMs = 5_000) {
  return {
    serverId: 'desk',
    sessionId: 'dev',
    observedAtMs,
    sessions,
  } satisfies GatewayAgentSessionsSnapshot;
}

function listed(asid: string, updatedMs: number, title = `Session ${asid}`): GatewayAgentSession {
  return { asid, agentId: 'codex', title, directory: '/work', status: 'busy', updatedMs };
}

const started: HomeThreadSession = {
  kind: 'session',
  serverId: 'desk',
  sessionId: 'muqun-home',
  asid: 'new',
  agentId: 'codex',
  directory: '/work',
  title: 'Which base should I compare against?',
  lastSent: 'Which base should I compare against?',
  sentAtMs: 4_000,
  setAtMs: 4_000,
};

test('a session Home just started is a row before the listing names it, under the key it will have', () => {
  const before = homeContinueEntries({
    ...base,
    gatewaySessions: listing([listed('old', 1_000)], 3_000),
    threads: [started],
  });
  expect(before.map((row) => row.key)).toEqual([
    goneSessionKey('desk', 'new', 'codex'),
    goneSessionKey('desk', 'old', 'codex'),
  ]);
  expect(before[0]).toMatchObject({
    title: started.title,
    atMs: 4_000,
    destination: { type: 'agent-session', target: { asid: 'new', agentId: 'codex' } },
  });

  // The listing catches up: the same key in the same place, and only once.
  const after = homeContinueEntries({
    ...base,
    gatewaySessions: listing([listed('old', 1_000), listed('new', 4_200, '')]),
    threads: [started],
  });
  expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
  // A listed placeholder title keeps the card's name rather than blanking it.
  expect(after[0]?.title).toBe(started.title);
  expect(after[0]?.atMs).toBe(4_200);
});

test('the gateway clock behind the device does not drop a just-started session down the list', () => {
  const rows = homeContinueEntries({
    ...base,
    gatewaySessions: listing([listed('other', 3_900), listed('new', 3_500)]),
    threads: [started],
  });
  expect(rows.map((row) => row.key)).toEqual([
    goneSessionKey('desk', 'new', 'codex'),
    goneSessionKey('desk', 'other', 'codex'),
  ]);
});

test('a session already a recent is not added again, and a gone or offline one not at all', () => {
  const recent: HomeRecentEntry = {
    key: 'recent-new',
    title: 'Opened',
    atMs: 2_000,
    target: {
      kind: 'agent-session',
      serverId: 'desk',
      sessionId: 'muqun-home',
      directory: '/work',
      asid: 'new',
      agentId: 'codex',
    },
  };
  const deduped = homeContinueEntries({ ...base, recents: [recent], threads: [started] });
  expect(deduped.map((row) => [row.key, row.atMs])).toEqual([['recent-new', 4_000]]);

  const gone = homeContinueEntries({
    ...base,
    goneSessions: new Set([goneSessionKey('desk', 'new', 'codex')]),
    threads: [started],
  });
  expect(gone).toEqual([]);

  const offline = homeContinueEntries({
    ...base,
    reachabilityByServer: { desk: 'offline' },
    threads: [started],
  });
  expect(offline).toEqual([]);
  // Another computer's target is that computer's, not this one's.
  expect(homeContinueEntries({ ...base, threads: [{ ...started, serverId: 'box' }] })).toEqual([]);
});

test('a pane Home started stands in until the pane mirror reads it, then the mirror row keeps its place', () => {
  const pane: HomeThreadPane = {
    kind: 'pane',
    serverId: 'desk',
    sessionId: 'dev',
    paneId: 'p9',
    agentLabel: 'codex',
    instanceId: 'inst-9',
    title: 'Reply PONG',
    sentAtMs: 4_000,
    setAtMs: 4_000,
  };
  const older: ServerAgentsSnapshot = {
    serverId: 'desk',
    sessionId: 'dev',
    checkedAtMs: 3_000,
    agents: [{ id: 'a1', name: 'shell', status: 'idle', hasAgent: true, paneId: 'p1' }],
  };
  const before = homeContinueEntries({ ...base, snapshots: { desk: older }, threads: [pane] });
  expect(before[0]).toMatchObject({
    key: JSON.stringify([JSON.stringify(['desk', 'instance', 'inst-9']), 'dev']),
    atMs: 4_000,
    agentLabel: 'codex',
    destination: { type: 'pane', serverId: 'desk', paneId: 'p9' },
  });

  const read: ServerAgentsSnapshot = {
    ...older,
    checkedAtMs: 5_000,
    agents: [
      ...older.agents,
      {
        id: 'a9',
        name: 'codex',
        status: 'working',
        hasAgent: true,
        paneId: 'p9',
        instanceId: 'inst-9',
      },
    ],
  };
  const after = homeContinueEntries({ ...base, snapshots: { desk: read }, threads: [pane] });
  expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
  expect(after[0]?.atMs).toBe(4_000);

  // A mirror newer than the target without the pane: it has gone, no card lingers.
  const closed = homeContinueEntries({
    ...base,
    snapshots: { desk: { ...older, checkedAtMs: 5_000 } },
    threads: [pane],
  });
  expect(
    closed.some((row) => row.destination.type === 'pane' && row.destination.paneId === 'p9')
  ).toBe(false);
});

test('a just-started pane keeps its known routing session before the mirror catches up', () => {
  const pane: HomeThreadPane = {
    kind: 'pane',
    serverId: 'desk',
    sessionId: 'other-routing-session',
    paneId: 'p9',
    title: 'New work',
    setAtMs: 4_000,
  };
  const rows = homeContinueEntries({ ...base, threads: [pane] });
  expect(homeContinueCommand(rows[0]!.destination)).toEqual({
    type: 'resume-server',
    target: {
      kind: 'gateway-terminal',
      serverId: 'desk',
      sessionId: 'other-routing-session',
      paneId: 'p9',
    },
  });
});

test('a mirror in another routing session cannot merge or retire a same-ID Home pane', () => {
  const pane: HomeThreadPane = {
    kind: 'pane',
    serverId: 'desk',
    sessionId: 'work',
    paneId: 'p1',
    title: 'Work conversation',
    setAtMs: 4_000,
    sentAtMs: 4_000,
  };
  for (const sessionId of ['dev', undefined]) {
    const rows = homeContinueEntries({
      ...base,
      threads: [pane],
      snapshots: {
        desk: {
          serverId: 'desk',
          sessionId,
          checkedAtMs: 5_000,
          agents: [
            { id: 'p1', paneId: 'p1', name: 'Other shell', hasAgent: false, status: 'idle' },
          ],
        },
      },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(
      rows
        .map((row) => homeContinueCommand(row.destination))
        .find((command) => command.type === 'resume-server' && command.target.sessionId === 'work')
    ).toEqual({
      type: 'resume-server',
      target: { kind: 'gateway-terminal', serverId: 'desk', sessionId: 'work', paneId: 'p1' },
    });
  }
});

test('same session IDs owned by different providers keep separate Home thread destinations', () => {
  const rows = homeContinueEntries({
    ...base,
    gatewaySessions: listing([{ ...listed('new', 3_000), agentId: 'claude' }]),
    threads: [started],
  });
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => homeContinueCommand(row.destination))).toEqual([
    {
      type: 'open-agent',
      target: {
        kind: 'agent-session',
        serverId: 'desk',
        sessionId: 'muqun-home',
        directory: '/work',
        asid: 'new',
        agentId: 'codex',
      },
    },
    {
      type: 'open-agent',
      target: {
        kind: 'agent-session',
        serverId: 'desk',
        sessionId: 'dev',
        directory: '/work',
        asid: 'new',
        agentId: 'claude',
      },
    },
  ]);
});

test('an older listing cannot hide a pane targeted by Home afterward', () => {
  const rows = homeContinueEntries({
    ...base,
    gatewaySessions: listing(
      [{ ...listed('old', 1_000), terminal: { sessionId: 'dev', paneId: 'p9' } }],
      2_000
    ),
    threads: [
      {
        kind: 'pane',
        serverId: 'desk',
        sessionId: 'dev',
        paneId: 'p9',
        instanceId: 'new',
        title: 'New work',
        setAtMs: 3_000,
      },
    ],
  });
  expect(rows.map((row) => row.destination.type)).toEqual(['pane', 'agent-session']);
});
