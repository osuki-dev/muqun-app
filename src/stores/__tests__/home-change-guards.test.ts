import * as bunTest from 'bun:test';

const { expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

// The same MMKV stand-in `agents.test.ts` registers (`mock.module` is process-wide).
const stored = new Map<string, string>();
mockModule('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
  }),
}));

const { parseGatewayDiscovery } = await import('@/lib/agent-protocol');
const { createHomeRecentsStore } = await import('@/lib/home-recents-state');
const { createServerAgentsStore, selectServerAgentsContent } =
  await import('@/lib/server-agents-state');
const { useAgents } = await import('../agents');
const { useHomeAgentSessions } = await import('../home-agent-sessions');

const target = {
  kind: 'agent-session' as const,
  serverId: 'desk',
  sessionId: 'dev',
  directory: '/work',
  asid: 'session-1',
};
const discovery = parseGatewayDiscovery({
  planes: {
    agents: {
      supported: true,
      agents: [{ id: 'opencode', name: 'OpenCode', kind: 'opencode', status: 'connected' }],
    },
  },
});
const panes = (checkedAtMs: number, status: 'idle' | 'working') => ({
  serverId: 'desk',
  sessionId: 'dev',
  checkedAtMs,
  agents: [{ id: 'a', paneId: 'p1', name: 'Agent', hasAgent: true, status }],
});
const listing = (observedAtMs: number, status: 'idle' | 'busy') => ({
  serverId: 'desk',
  sessionId: 'dev',
  observedAtMs,
  sessions: [
    {
      asid: 'session-1',
      agentId: 'opencode',
      title: 'T',
      directory: '/work',
      status,
      updatedMs: 1,
    },
  ],
});

/**
 * Each guard, fed the same answer twice with only the time moved, then a real
 * change: the object Home subscribes to must survive the first and not the
 * second, and the keychain must hear only about the second.
 */
test('an answer that changes nothing but its time leaves what Home subscribes to alone', async () => {
  const cases: {
    name: string;
    run: () => Promise<{ same: boolean; changed: boolean; writes?: number }>;
    writes?: number;
  }[] = [
    {
      name: 'home-recents observeSession',
      writes: 1,
      run: async () => {
        let writes = 0;
        const store = createHomeRecentsStore({
          load: async () => null,
          save: async () => {
            writes++;
          },
        });
        await store.getState().visit(target, 'T', 1, { status: 'idle', observedAtMs: 10 });
        writes = 0;
        const before = store.getState().entries;
        await store.getState().observeSession(target, { status: 'idle', observedAtMs: 20 });
        const same =
          store.getState().entries === before && store.getState().seenAtMs[before[0].key] === 20;
        await store.getState().observeSession(target, { status: 'busy', observedAtMs: 30 });
        return { same, changed: store.getState().entries !== before, writes };
      },
    },
    {
      name: 'server-agents record, as Home selects it',
      run: async () => {
        const store = createServerAgentsStore({ load: async () => ({}), save: async () => {} });
        await store.getState().record(panes(10, 'idle'));
        const before = selectServerAgentsContent(store.getState());
        await store.getState().record(panes(20, 'idle'));
        const same = selectServerAgentsContent(store.getState()) === before;
        await store.getState().record(panes(30, 'working'));
        return { same, changed: selectServerAgentsContent(store.getState()) !== before };
      },
    },
    {
      name: 'home-agent-sessions record',
      run: async () => {
        const store = useHomeAgentSessions;
        store.getState().record(listing(10, 'idle'));
        const before = store.getState().byServer;
        store.getState().record(listing(20, 'idle'));
        const same = store.getState().byServer === before && store.getState().seenAtMs.desk === 20;
        store.getState().record(listing(30, 'busy'));
        return { same, changed: store.getState().byServer !== before };
      },
    },
    {
      name: 'agents record',
      run: async () => {
        useAgents.getState().record('desk', discovery, 10);
        const before = useAgents.getState().index;
        useAgents.getState().record('desk', discovery, 20);
        const same = useAgents.getState().index === before;
        useAgents.getState().select('desk', 'deepseek');
        return { same, changed: useAgents.getState().index !== before };
      },
    },
  ];
  for (const testCase of cases) {
    const result = await testCase.run();
    expect({ name: testCase.name, ...result }).toEqual({
      name: testCase.name,
      same: true,
      changed: true,
      ...(testCase.writes === undefined ? {} : { writes: testCase.writes }),
    });
  }
});
