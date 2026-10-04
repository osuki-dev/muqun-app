import { expect, test } from 'bun:test';

import type { AgentSessionInfo } from '../agent-protocol';
import {
  agentSessionStatusPresentation,
  gatewayAgentSessions,
  homeContinueCommand,
  homeContinueEntries,
  goneSessionKey,
  homeContinueKind,
  HOME_CONTINUE_GATEWAY_SESSION_LIMIT,
  type GatewayAgentSession,
  type GatewayAgentSessionsSnapshot,
} from '../home-continue';
import { createHomeRecentsStore } from '../home-recents-state';
import type { HomeRecentEntry } from '../home-recents';

function session(asid: string, updatedMs: number, extra: Partial<GatewayAgentSession> = {}) {
  return {
    asid,
    agentId: 'deepseek',
    title: `Session ${asid}`,
    directory: '/work',
    status: 'idle' as const,
    updatedMs,
    ...extra,
  };
}

function snapshot(sessions: GatewayAgentSession[], serverId = 'osk'): GatewayAgentSessionsSnapshot {
  return { serverId, sessionId: 'dev', observedAtMs: 1_000, sessions };
}

const base = {
  serverIds: ['osk'],
  hostIds: [],
  snapshots: {},
  recents: [] as HomeRecentEntry[],
  reachabilityByServer: { osk: 'live' as const },
  paneMode: 'all' as const,
  nowMs: 1_000,
};

function info(asid: string, updated_ms: number, extra: Partial<AgentSessionInfo> = {}) {
  return {
    asid,
    backend_session_id: asid,
    agent_id: 't3',
    title: asid,
    model: null,
    status: 'busy',
    updated_ms,
    ...extra,
  } as AgentSessionInfo;
}

test('the listing keeps the N most recently updated root sessions, newest first', () => {
  const list = [
    ...Array.from({ length: 12 }, (_, index) => info(`s${index}`, index)),
    info('child', 100, { parent_id: 's1' }),
    info('gone', 101, { deleted: true }),
  ];
  const kept = gatewayAgentSessions(list);
  expect(HOME_CONTINUE_GATEWAY_SESSION_LIMIT).toBe(8);
  expect(kept.map((row) => row.asid)).toEqual(['s11', 's10', 's9', 's8', 's7', 's6', 's5', 's4']);
  expect(kept[0]).toMatchObject({ agentId: 't3', status: 'busy', updatedMs: 11 });
  expect(gatewayAgentSessions(list, 2)).toHaveLength(2);
});

test('gateway sessions join Continue as agent-session rows ranked by their update time', () => {
  const rows = homeContinueEntries({
    ...base,
    recents: [
      {
        key: 'ssh',
        title: 'Box',
        atMs: 500,
        target: { kind: 'ssh-host', hostId: 'box' },
      },
    ],
    hostIds: ['box'],
    gatewaySessions: snapshot([session('a', 900), session('b', 100, { status: 'busy' })]),
  });
  expect(rows.map((row) => row.title)).toEqual(['Session a', 'Box', 'Session b']);
  expect(rows[0].destination).toEqual({
    type: 'agent-session',
    target: {
      kind: 'agent-session',
      serverId: 'osk',
      sessionId: 'dev',
      directory: '/work',
      asid: 'a',
      agentId: 'deepseek',
    },
  });
  expect(rows[2].observation).toMatchObject({ kind: 'agent-session', status: 'busy' });
});

test('a gateway session a recent already points at is that recent, not a second row', () => {
  const recent: HomeRecentEntry = {
    key: 'recent-a',
    title: 'Mine',
    atMs: 50,
    target: {
      kind: 'agent-session',
      serverId: 'osk',
      sessionId: 'other-routing',
      directory: '/elsewhere',
      asid: 'a',
      agentId: 'deepseek',
    },
  };
  const rows = homeContinueEntries({
    ...base,
    recents: [recent],
    gatewaySessions: snapshot([session('a', 900, { status: 'busy' })]),
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].key).toBe('recent-a');
  expect(rows[0].title).toBe('Mine');
  // Updated on the gateway after the visit: it rises to the update time.
  expect(rows[0].atMs).toBe(900);
  expect(rows[0].observation).toMatchObject({ status: 'busy' });
  expect(rows[0].destination.type).toBe('recent');
});

test("the gateway's agent wins over a recent recorded before agents were tagged", () => {
  // "Pong Response": a T3 session this device remembered without an agent.
  const recent: HomeRecentEntry = {
    key: 'pong',
    title: 'Pong Response',
    atMs: 50,
    target: {
      kind: 'agent-session',
      serverId: 'osk',
      sessionId: 'dev',
      directory: '/work',
      asid: '9cedff14',
    },
  };
  const before = homeContinueEntries({ ...base, recents: [recent] });
  expect(homeContinueKind(before[0].destination)).toEqual({ kind: 'agent', agentId: 'opencode' });

  const after = homeContinueEntries({
    ...base,
    recents: [recent],
    gatewaySessions: snapshot([session('9cedff14', 10, { agentId: 't3' })]),
  });
  expect(after).toHaveLength(1);
  expect(homeContinueKind(after[0].destination)).toEqual({ kind: 'agent', agentId: 't3' });
  expect(homeContinueCommand(after[0].destination)).toMatchObject({
    type: 'resume-target',
    target: { asid: '9cedff14', agentId: 't3' },
  });
});

test('an offline, unpaired or unselected gateway contributes nothing', () => {
  const listed = snapshot([session('a', 900)]);
  expect(
    homeContinueEntries({
      ...base,
      reachabilityByServer: { osk: 'offline' },
      gatewaySessions: listed,
    })
  ).toEqual([]);
  expect(homeContinueEntries({ ...base, serverIds: ['other'], gatewaySessions: listed })).toEqual(
    []
  );
});

test('tapping a gateway session opens the workbench on it with its agent', () => {
  const [row] = homeContinueEntries({ ...base, gatewaySessions: snapshot([session('a', 9)]) });
  expect(homeContinueCommand(row.destination)).toEqual({
    type: 'open-agent',
    target: {
      kind: 'agent-session',
      serverId: 'osk',
      sessionId: 'dev',
      directory: '/work',
      asid: 'a',
      agentId: 'deepseek',
    },
  });
});

test('captions name the agent only for agent rows', () => {
  expect(homeContinueKind({ type: 'pane', serverId: 'osk', paneId: 'p' })).toEqual({
    kind: 'terminal',
  });
  expect(homeContinueKind({ type: 'recent', target: { kind: 'ssh-host', hostId: 'box' } })).toEqual(
    { kind: 'ssh' }
  );
  const [row] = homeContinueEntries({ ...base, gatewaySessions: snapshot([session('a', 9)]) });
  expect(homeContinueKind(row.destination)).toEqual({ kind: 'agent', agentId: 'deepseek' });
});

test('every agent session status maps to one word and one tone', () => {
  expect(agentSessionStatusPresentation('busy')).toEqual({ word: 'running', tone: 'info' });
  expect(agentSessionStatusPresentation('retry')).toEqual({ word: 'retrying', tone: 'info' });
  expect(agentSessionStatusPresentation('idle')).toEqual({ word: 'idle', tone: 'textSubtle' });
  expect(agentSessionStatusPresentation('failed')).toEqual({ word: 'failed', tone: 'danger' });
  expect(agentSessionStatusPresentation('interrupted')).toEqual({
    word: 'stopped',
    tone: 'warning',
  });
  expect(agentSessionStatusPresentation('unknown')).toEqual({
    word: 'unknown',
    tone: 'textSubtle',
  });
});

test('repairAgent writes the agent in place without reordering or creating a visit', async () => {
  let saved = '';
  const store = createHomeRecentsStore({
    load: async () => null,
    save: async (value) => {
      saved = value;
    },
  });
  const target = {
    kind: 'agent-session' as const,
    serverId: 'osk',
    sessionId: 'dev',
    directory: '/work',
    asid: '9cedff14',
  };
  await store.getState().visit(target, 'Pong Response', 20);
  await store.getState().visit({ kind: 'ssh-host', hostId: 'box' }, 'Box', 30);
  await store.getState().repairAgent({ ...target, asid: 'unknown' }, 't3');
  await store.getState().repairAgent(target, 't3');
  const entries = store.getState().entries;
  expect(entries.map((entry) => entry.title)).toEqual(['Box', 'Pong Response']);
  expect(entries[1].target).toEqual({ ...target, agentId: 't3' });
  expect(entries[1].atMs).toBe(20);
  expect(saved).toContain('"agentId":"t3"');
});

test('a session the gateway answered gone is neither a recent row nor a listed one', () => {
  const recent: HomeRecentEntry = {
    key: 'r',
    title: 'Greeting',
    atMs: 500,
    target: {
      kind: 'agent-session',
      serverId: 'osk',
      sessionId: 'dev',
      directory: '/x',
      asid: 'a',
    },
  };
  const input = {
    ...base,
    recents: [recent],
    gatewaySessions: snapshot([session('a', 900), session('b', 100)]),
  };
  const keys = (goneSessions?: ReadonlySet<string>) =>
    homeContinueEntries({ ...input, ...(goneSessions ? { goneSessions } : {}) }).map((row) =>
      row.destination.type === 'recent' || row.destination.type === 'agent-session'
        ? row.destination.target.kind === 'agent-session'
          ? row.destination.target.asid
          : ''
        : ''
    );
  expect(keys()).toEqual(['a', 'b']);
  expect(keys(new Set([goneSessionKey('osk', 'a')]))).toEqual(['b']);
  // Another gateway's session with the same id is a different session.
  expect(keys(new Set([goneSessionKey('other', 'a')]))).toEqual(['a', 'b']);
});
