import { expect, test } from 'bun:test';

import type { AgentSessionListing } from '../gone-agent-sessions';
import { refreshHomeContinue } from '../home-continue-refresh';
import type { HomeRecentEntry } from '../home-recents';

const remembered = (asid: string, directory: string): HomeRecentEntry => ({
  key: asid,
  title: asid,
  atMs: 1,
  target: {
    kind: 'agent-session',
    serverId: 'desk',
    sessionId: 'dev',
    directory,
    asid,
    agentId: 'claude',
  },
});
const row = (asid: string, directory: string) => ({
  asid,
  agent_id: 'claude',
  title: asid,
  status: 'idle',
  updated_ms: 1,
  directory,
});

test('the refresh reports what it saw, and a folder counts as searched only when it answered', async () => {
  const listings: AgentSessionListing[] = [];
  await refreshHomeContinue({
    serverId: 'desk',
    sessionId: 'dev',
    entries: [remembered('answered', '/a'), remembered('failed', '/b'), remembered('listed', '/c')],
    read: async (path) => {
      if (path.startsWith('/api/agent-sessions?'))
        return { data: [row('listed', '/c'), row('other', '/x')] };
      if (path.includes('directory=%2Fa')) return [row('found-in-a', '/a')];
      if (path.includes('directory=%2Fb')) throw new Error('offline');
      return [];
    },
    isCurrent: () => true,
    recordPanes: async () => {},
    observe: async () => {},
    updateTitle: async () => {},
    confirmSessions: (listing) => listings.push(listing),
  });
  expect(listings.map(({ observedAtMs, ...rest }) => rest)).toEqual([
    {
      serverId: 'desk',
      seen: [
        { asid: 'listed', agentId: 'claude' },
        { asid: 'other', agentId: 'claude' },
        { asid: 'found-in-a', agentId: 'claude' },
      ],
      complete: true,
      searched: ['answered'],
    },
  ]);
  expect(listings[0]?.observedAtMs).toBeGreaterThan(0);
});

test('a failed listing confirms nothing', async () => {
  let confirmed = 0;
  const results = await refreshHomeContinue({
    serverId: 'desk',
    sessionId: 'dev',
    entries: [remembered('kept', '/a')],
    read: async (path) => {
      if (path.startsWith('/api/agent-sessions?')) throw new Error('503 agent_unavailable');
      return [];
    },
    isCurrent: () => true,
    recordPanes: async () => {},
    observe: async () => {},
    updateTitle: async () => {},
    confirmSessions: () => confirmed++,
  });
  expect(results[1]?.status).toBe('rejected');
  expect(confirmed).toBe(0);
});
