import { expect, test } from 'bun:test';

import { goneSessionKey, homeContinueEntries } from '../home-continue';
import {
  AGENT_SESSION_DELETE_SCOPED_CAPABILITY,
  deleteHomeSession,
  homeSessionDeleteTarget,
  HomeSessionDeleteUnavailableError,
  type HomeDeletableTarget,
} from '../home-session-delete';

const agent: HomeDeletableTarget = {
  kind: 'agent-session',
  serverId: 'computer-b',
  sessionId: 'routing-b',
  asid: 'session/b',
  directory: '/project',
  agentId: 'provider/b',
};
const capabilities = [AGENT_SESSION_DELETE_SCOPED_CAPABILITY];

test('an untagged legacy recent cannot assume the default provider or send DELETE', async () => {
  let removed = false;
  const legacy = { ...agent, agentId: undefined };
  expect(
    homeSessionDeleteTarget({
      key: 'legacy',
      title: 'Unknown owner',
      atMs: 1,
      destination: { type: 'recent', target: legacy },
    })
  ).toBeUndefined();
  await expect(
    deleteHomeSession({
      target: legacy,
      capabilities,
      remove: async () => {
        removed = true;
      },
      forget: async () => {
        throw new Error('must retain history');
      },
    })
  ).rejects.toThrow(new HomeSessionDeleteUnavailableError('provider'));
  expect(removed).toBe(false);
});

test('Home freezes the row provider and rejects terminal and SSH deletion targets', () => {
  const entry = {
    key: 'session',
    title: 'Goal',
    atMs: 0,
    destination: { type: 'agent-session' as const, target: agent },
  };
  const captured = homeSessionDeleteTarget(entry);
  agent.agentId = 'other';
  expect(captured?.agentId).toBe('provider/b');
  agent.agentId = 'provider/b';
  expect(
    homeSessionDeleteTarget({
      ...entry,
      destination: { type: 'pane', serverId: 'computer-b', paneId: 'pane' },
    })
  ).toBeUndefined();
  expect(
    homeSessionDeleteTarget({
      ...entry,
      destination: { type: 'recent', target: { kind: 'ssh-host', hostId: 'host' } },
    })
  ).toBeUndefined();
});

test('remote deletion names the exact provider and conversation, then forgets after confirmed success', async () => {
  const events: string[] = [];
  await deleteHomeSession({
    target: agent,
    capabilities,
    remove: async (path) => {
      events.push(`delete ${path}`);
    },
    forget: async (target) => {
      events.push(`forget ${target.serverId}`);
    },
  });
  expect(events).toEqual([
    'delete /api/agents/provider%2Fb/sessions/session%2Fb',
    'forget computer-b',
  ]);
});

test('older Gateways never receive a destructive request with an ignored provider query', async () => {
  let removed = false;
  await expect(
    deleteHomeSession({
      target: agent,
      capabilities: ['multi_agent'],
      remove: async () => {
        removed = true;
      },
      forget: async () => {
        throw new Error('must retain history');
      },
    })
  ).rejects.toThrow(new HomeSessionDeleteUnavailableError());
  expect(removed).toBe(false);
});

test('offline, unsupported, absent owner, and ambiguous deletion outcomes keep history and never retry', async () => {
  for (const message of [
    'offline',
    'HTTP 501: feature_unsupported',
    'HTTP 404: session_not_found',
    'Timed out',
  ]) {
    let writes = 0;
    let forgotten = false;
    await expect(
      deleteHomeSession({
        target: agent,
        capabilities,
        remove: async () => {
          writes++;
          throw new Error(message);
        },
        forget: async () => {
          forgotten = true;
        },
      })
    ).rejects.toThrow(message);
    expect(writes).toBe(1);
    expect(forgotten).toBe(false);
  }
});

test('scoped deletion hides only the selected provider from stale inventory with duplicate conversation IDs', () => {
  const sessions = ['opencode', 't3'].map((agentId) => ({
    asid: 'same',
    agentId,
    title: agentId,
    directory: '/project',
    status: 'idle' as const,
    updatedMs: 1,
  }));
  const input = {
    serverIds: ['computer'],
    hostIds: [],
    snapshots: {},
    recents: [],
    reachabilityByServer: {},
    paneMode: 'all' as const,
    gatewaySessions: { serverId: 'computer', sessionId: 'routing', observedAtMs: 1, sessions },
  };
  const before = homeContinueEntries(input);
  expect(before).toHaveLength(2);
  expect(new Set(before.map((row) => row.key)).size).toBe(2);
  const rows = homeContinueEntries({
    ...input,
    goneSessions: new Set([goneSessionKey('computer', 'same', 'opencode')]),
  });
  expect(rows.map((row) => row.title)).toEqual(['t3']);
  const remembered = homeContinueEntries({
    ...input,
    recents: [
      {
        key: 'remembered-t3',
        title: 'Kept conversation',
        atMs: 2,
        target: {
          kind: 'agent-session',
          serverId: 'computer',
          sessionId: 'routing',
          directory: '/project',
          asid: 'same',
          agentId: 't3',
        },
      },
    ],
    goneSessions: new Set([goneSessionKey('computer', 'same', 'opencode')]),
  });
  expect(remembered.map((row) => row.title)).toEqual(['Kept conversation']);
});
