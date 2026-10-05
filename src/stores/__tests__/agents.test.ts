import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

/**
 * A map stands in for MMKV, the same fake `agent-model-memory.test.ts`
 * registers. Writable from the test, so a document a previous launch left
 * behind can be handed to the store and read back.
 */
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
const { agentFeaturesOn, homeAgentsFor, offersAgentChoiceOn, selectedAgentOn, useAgents } =
  await import('../agents');

const store = useAgents;

function discovery(statuses: Record<string, string>) {
  return parseGatewayDiscovery({
    planes: {
      agents: {
        supported: true,
        agents: Object.entries(statuses).map(([id, status]) => ({
          id,
          name: id,
          kind: id,
          status,
          enabled: true,
          endpoint: `http://127.0.0.1/${id}`,
          features: id === 'opencode' ? { revert: true } : { revert: false },
        })),
        features: { multiAgent: true },
      },
    },
  });
}

beforeEach(() => {
  stored.clear();
  store.getState().forgetAll();
});

describe('recording a discovery', () => {
  test('a server never asked offers nothing and answers every control on', () => {
    expect(homeAgentsFor('srv')).toEqual([]);
    expect(selectedAgentOn('srv')).toBe('opencode');
    expect(offersAgentChoiceOn('srv')).toBe(false);
    expect(agentFeaturesOn('srv', 'opencode').revert).toBe(true);
    expect(agentFeaturesOn('srv', 'deepseek').revert).toBe(true);
  });

  test('what the gateway said is what Home reads back, without endpoints', () => {
    store.getState().record('srv', discovery({ deepseek: 'connected', opencode: 'connected' }), 5);
    expect(homeAgentsFor('srv').map((a) => [a.id, a.readiness])).toEqual([
      ['deepseek', 'ready'],
      ['opencode', 'ready'],
    ]);
    expect(Object.keys(homeAgentsFor('srv')[0] ?? {})).not.toContain('endpoint');
    expect(offersAgentChoiceOn('srv')).toBe(true);
    expect(selectedAgentOn('srv')).toBe('deepseek');
    expect(agentFeaturesOn('srv', 'opencode').revert).toBe(true);
    expect(agentFeaturesOn('srv', 'deepseek').revert).toBe(false);
  });

  test('the pick and the last used agent are remembered, and a dead pick yields', () => {
    store.getState().record('srv', discovery({ deepseek: 'connected', opencode: 'connected' }));
    store.getState().select('srv', 'opencode');
    expect(selectedAgentOn('srv')).toBe('opencode');
    store.getState().record('srv', discovery({ deepseek: 'connected', opencode: 'offline' }));
    expect(selectedAgentOn('srv')).toBe('deepseek');
    store.getState().markUsed('srv', 'deepseek');
    expect(store.getState().index.lastUsed.srv).toBe('deepseek');
  });

  test('choosing what is already chosen leaves the store alone', () => {
    store.getState().select('srv', 'deepseek');
    const before = store.getState().index;
    store.getState().select('srv', 'deepseek');
    expect(store.getState().index).toBe(before);
    store.getState().markUsed('srv', 'deepseek');
    const after = store.getState().index;
    store.getState().markUsed('srv', 'deepseek');
    expect(store.getState().index).toBe(after);
  });
});

describe('persistence', () => {
  test('every write lands in storage as one versioned document', () => {
    store.getState().record('srv', discovery({ opencode: 'connected' }), 9);
    store.getState().select('srv', 'opencode');
    store.getState().markUsed('srv', 'opencode');
    const raw = stored.get('index.v1');
    expect(raw).toBeDefined();
    const doc = JSON.parse(raw ?? '{}') as {
      version: number;
      servers: Record<string, { observedAtMs: number; agents: { agents: unknown[] } }>;
      selected: Record<string, string>;
      lastUsed: Record<string, string>;
    };
    expect(doc.version).toBe(1);
    expect(doc.servers.srv.observedAtMs).toBe(9);
    expect(doc.servers.srv.agents.agents).toHaveLength(1);
    expect(doc.selected).toEqual({ srv: 'opencode' });
    expect(doc.lastUsed).toEqual({ srv: 'opencode' });
  });

  test('forgetting drops the document too', () => {
    store.getState().record('srv', discovery({ opencode: 'connected' }));
    store.getState().forgetAll();
    expect(homeAgentsFor('srv')).toEqual([]);
    expect(JSON.parse(stored.get('index.v1') ?? '{}')).toMatchObject({ servers: {} });
  });
});
