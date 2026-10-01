import { describe, expect, mock, test } from 'bun:test';

import {
  agentCacheVariant,
  agentFeaturesFor,
  agentIdQueryValue,
  agentReadiness,
  canMoveSessionToWorktree,
  emptyAgentsMirror,
  hasMultiAgent,
  hiddenClientCommands,
  lastUsedAgent,
  MAX_MIRRORED_DISCOVERY_SERVERS,
  mirrorDiscovery,
  offersAgentChoice,
  parseAgentsMirrorIndex,
  resolveSelectedAgent,
  selectedAgentFor,
  selectHomeAgents,
  serializeAgentsMirrorIndex,
  serverOffersAgentChoice,
  withAgentIdQuery,
  withMirroredDiscovery,
  type AgentsMirrorIndex,
} from '../agent-discovery';
import {
  DEFAULT_AGENT_ID,
  defaultAgentFeatures,
  LEGACY_AGENT_FEATURES,
  parseGatewayDiscovery,
  type AgentInfo,
  type GatewayDiscovery,
} from '../agent-protocol';
import { agentCatalogCacheVariant, agentCatalogPath } from '../agent-catalog-scope';

// `agent-cache` reaches for MMKV at import time; the same throwing fake the
// other cache tests register.
mock.module('react-native-mmkv', () => ({
  createMMKV: () => {
    throw new Error('no native MMKV in tests');
  },
}));

const { AGENT_CACHE_SCHEMA, buildAgentCacheKey } = await import('../agent-cache');

function agent(over: Partial<AgentInfo> & Pick<AgentInfo, 'id'>): AgentInfo {
  return {
    kind: over.id,
    name: over.id,
    status: 'connected',
    enabled: true,
    models: [],
    modes: [],
    features: defaultAgentFeatures(),
    ...over,
  };
}

/** What `GET /api/discovery` answers, as the gateway spells it. */
const gatewayAnswer = {
  ok: true,
  gatewayVersion: '3.1.0',
  apiVersion: '3.1',
  apiMajor: 3,
  platform: 'linux',
  serverId: 'srv-1',
  label: 'Studio',
  planes: {
    terminal: {
      supported: true,
      mode: 'herdr',
      activeBackend: 'main',
      backends: [
        {
          sessionId: 'main',
          label: 'main',
          kind: 'herdr',
          connected: true,
          version: '0.9.2',
          capabilities: ['pane_context', 'agent_collaboration'],
        },
      ],
      features: { multiWindow: true },
    },
    agents: {
      supported: true,
      agents: [
        {
          id: 'deepseek',
          name: 'DeepSeek Harness',
          kind: 'deepseek',
          status: 'connected',
          enabled: true,
          endpoint: 'http://127.0.0.1:4200',
          version: '0.3.0',
          models: [
            {
              id: 'deepseek-v4',
              name: 'DeepSeek V4',
              providerId: 'deepseek',
              supportsReasoning: true,
              reasoningEffortTiers: ['low', 'high'],
            },
          ],
          modes: [{ id: 'default', name: 'Default', description: 'The only one.' }],
          features: {
            streaming: true,
            reasoningEffort: true,
            modelSelection: true,
            toolApprovals: true,
            worktrees: false,
            revert: false,
            inbox: false,
            modes: true,
            skills: false,
            slashCommands: false,
            compaction: false,
            backgroundShells: false,
            attachments: false,
          },
        },
        {
          id: 'opencode',
          name: 'OpenCode',
          kind: 'opencode',
          status: 'offline',
          enabled: true,
          models: [],
          modes: [],
          features: {
            streaming: true,
            reasoningEffort: false,
            modelSelection: false,
            toolApprovals: true,
            worktrees: true,
            revert: true,
            inbox: true,
          },
        },
      ],
      features: { multiAgent: true, catalogAggregation: true, sessionRouting: true },
    },
    ssh: { supported: true, tunnelSupported: true, pushTokenSupported: true },
  },
  capabilities: ['agent_sessions', 'multi_agent'],
};

const discovery: GatewayDiscovery = parseGatewayDiscovery(gatewayAnswer);

describe('the capability gate', () => {
  test('only `multi_agent` turns discovery on', () => {
    expect(hasMultiAgent(['agent_sessions', 'multi_agent'])).toBe(true);
    expect(hasMultiAgent(['agent_sessions'])).toBe(false);
    expect(hasMultiAgent(undefined)).toBe(false);
  });
});

describe('naming an agent on the wire', () => {
  test('the default agent is never spelled out', () => {
    expect(agentIdQueryValue('opencode')).toBeUndefined();
    expect(agentIdQueryValue(undefined)).toBeUndefined();
    expect(agentIdQueryValue('')).toBeUndefined();
    expect(agentIdQueryValue('deepseek')).toBe('deepseek');
  });

  test('`?agent_id=` joins whatever query is already there', () => {
    expect(withAgentIdQuery('/api/agent-status', 'opencode')).toBe('/api/agent-status');
    expect(withAgentIdQuery('/api/agent-status', 'deepseek')).toBe(
      '/api/agent-status?agent_id=deepseek'
    );
    expect(withAgentIdQuery('/api/agent-catalog?directory=%2Fwork', 'deepseek')).toBe(
      '/api/agent-catalog?directory=%2Fwork&agent_id=deepseek'
    );
    expect(agentCatalogPath(undefined, '/work', 'deepseek')).toBe(
      '/api/agent-catalog?directory=%2Fwork&agent_id=deepseek'
    );
    // The catalog names the default agent too: unnamed, a multi-agent
    // gateway merges every agent's catalog into one answer.
    expect(agentCatalogPath('herdr', undefined, 'opencode')).toBe(
      '/api/sessions/herdr/agent-catalog?agent_id=opencode'
    );
    expect(agentCatalogPath('herdr')).toBe('/api/sessions/herdr/agent-catalog');
  });

  test('cache keys keep every entry written before agents existed', () => {
    const before = `catalog@${AGENT_CACHE_SCHEMA}:default_gateway:herdr`;
    expect(buildAgentCacheKey('catalog', null, 'herdr')).toBe(before);
    expect(buildAgentCacheKey('catalog', null, 'herdr', null, 'opencode')).toBe(before);
    expect(buildAgentCacheKey('catalog', null, 'herdr', null, 'deepseek')).toBe(
      `${before}:agent=deepseek`
    );
    expect(buildAgentCacheKey('catalog', null, 'herdr', 'dir=/work', 'deepseek')).toBe(
      `${before}:dir=/work;agent=deepseek`
    );
    expect(agentCacheVariant(null, undefined)).toBeNull();
    expect(agentCatalogCacheVariant('/work')).toBe('dir=/work');
    expect(agentCatalogCacheVariant('/work', 'opencode')).toBe('dir=/work;agent=opencode');
    expect(agentCatalogCacheVariant(undefined, 'deepseek')).toBe('agent=deepseek');
  });
});

describe('readiness', () => {
  test.each([
    ['connected', 'ready'],
    ['reachable', 'ready'],
    ['not_installed', 'not-installed'],
    ['disabled', 'unsupported'],
    ['unconfigured', 'unsupported'],
    ['offline', 'offline'],
    ['unknown', 'offline'],
  ] as const)('%s reads as %s', (status, readiness) => {
    expect(agentReadiness({ status, enabled: true })).toBe(readiness);
  });

  test('an unpaired T3 (unconfigured) is unsupported, not offline, and not offered', () => {
    const t3 = agent({ id: 't3', status: 'unconfigured' });
    expect(agentReadiness(t3)).toBe('unsupported');
    expect(resolveSelectedAgent('t3', { agents: [t3, agent({ id: 'opencode' })] })).toBe(
      'opencode'
    );
  });

  test('a disabled agent is unsupported whatever its status says', () => {
    expect(agentReadiness({ status: 'connected', enabled: false })).toBe('unsupported');
  });
});

describe('which agent a new session goes to', () => {
  const plane = {
    agents: [
      agent({ id: 'deepseek', status: 'offline' }),
      agent({ id: 'opencode' }),
      agent({ id: 't3', status: 'reachable' }),
    ],
  };

  test('with no discovery the pick stands, and nothing is the default', () => {
    expect(resolveSelectedAgent(undefined, null)).toBe(DEFAULT_AGENT_ID);
    expect(resolveSelectedAgent('deepseek', undefined)).toBe('deepseek');
  });

  test('a ready pick wins; an offline pick yields to the first ready agent in gateway order', () => {
    expect(resolveSelectedAgent('t3', plane)).toBe('t3');
    expect(resolveSelectedAgent('deepseek', plane)).toBe('opencode');
    expect(resolveSelectedAgent(undefined, plane)).toBe('opencode');
  });

  test('with nothing ready the pick is kept rather than invented', () => {
    const dark = { agents: [agent({ id: 'deepseek', status: 'offline' })] };
    expect(resolveSelectedAgent('deepseek', dark)).toBe('deepseek');
    expect(resolveSelectedAgent(undefined, dark)).toBe(DEFAULT_AGENT_ID);
  });

  test('a choice is offered only with more than one ready agent', () => {
    expect(offersAgentChoice(plane)).toBe(true);
    expect(offersAgentChoice({ agents: [agent({ id: 'opencode' })] })).toBe(false);
    expect(offersAgentChoice(null)).toBe(false);
  });
});

describe('features and gating', () => {
  test('an agent nobody has described has every control, whatever its kind', () => {
    expect(agentFeaturesFor(undefined, 'opencode')).toEqual({ ...LEGACY_AGENT_FEATURES });
    expect(agentFeaturesFor(undefined, undefined).revert).toBe(true);
    expect(agentFeaturesFor([], 'deepseek')).toEqual({ ...LEGACY_AGENT_FEATURES });
  });

  test('a listed agent answers with what the gateway said', () => {
    const agents = discovery.agents?.agents ?? [];
    expect(agentFeaturesFor(agents, 'deepseek')).toMatchObject({
      worktrees: false,
      revert: false,
      inbox: false,
      reasoningEffort: true,
      modelSelection: true,
      compaction: false,
      backgroundShells: false,
      modes: true,
      skills: false,
      slashCommands: false,
      attachments: false,
    });
    expect(agentFeaturesFor(agents, 'opencode')).toMatchObject({
      worktrees: true,
      revert: true,
      inbox: true,
      reasoningEffort: false,
      modelSelection: false,
      compaction: true,
      modes: true,
    });
  });

  // These run as zustand selectors; a new object per call never lets the
  // store's snapshot settle and loops the workbench ("Maximum update depth").
  test('the same input answers the same object', () => {
    expect(agentFeaturesFor(undefined, 'opencode')).toBe(agentFeaturesFor(undefined, 'opencode'));
    expect(agentFeaturesFor([], 'deepseek')).toBe(agentFeaturesFor(undefined, 'deepseek'));
    const agents = discovery.agents?.agents ?? [];
    expect(agentFeaturesFor(agents, 'deepseek')).toBe(agentFeaturesFor(agents, 'deepseek'));
  });

  test('the composer hides exactly the commands the agent cannot answer', () => {
    expect(hiddenClientCommands({ ...LEGACY_AGENT_FEATURES })).toEqual([]);
    expect(
      hiddenClientCommands({
        ...LEGACY_AGENT_FEATURES,
        revert: false,
        compaction: false,
        modes: false,
      })
    ).toEqual(['undo', 'keep', 'compact', 'agents']);
    expect(
      hiddenClientCommands({ ...LEGACY_AGENT_FEATURES, revert: false, compaction: false })
    ).toEqual(['undo', 'keep', 'compact']);
    expect(hiddenClientCommands({ ...LEGACY_AGENT_FEATURES, stagedRevert: false })).toEqual([
      'keep',
    ]);
  });
});

describe('moving a session to a worktree', () => {
  const agents = () => discovery.agents?.agents ?? [];

  test('is offered only on a session whose agent reports worktrees', () => {
    expect(canMoveSessionToWorktree(agents(), 'deepseek')).toBe(false);
    expect(canMoveSessionToWorktree(agents(), 'opencode')).toBe(true);
  });

  test('an agent nobody has described keeps it, as OpenCode always had it', () => {
    expect(canMoveSessionToWorktree(undefined, 'opencode')).toBe(true);
    expect(canMoveSessionToWorktree([], undefined)).toBe(true);
    expect(canMoveSessionToWorktree(agents(), 'unlisted')).toBe(true);
  });
});

describe('the mirror', () => {
  const mirrored = mirrorDiscovery(discovery, 1_700_000_000_000);

  test('drops what only a paired device was told, and the lists the catalog serves', () => {
    const deepseek = mirrored.agents?.agents[0];
    expect(deepseek).toBeDefined();
    expect(Object.keys(deepseek ?? {})).not.toContain('endpoint');
    expect(Object.keys(deepseek ?? {})).not.toContain('version');
    expect(Object.keys(deepseek ?? {})).not.toContain('models');
    expect(Object.keys(deepseek ?? {})).not.toContain('modes');
    expect(deepseek).toMatchObject({ id: 'deepseek', kind: 'deepseek', status: 'connected' });
    expect(mirrored.terminal?.backends[0]).toMatchObject({ sessionId: 'main', connected: true });
    expect(mirrored.ssh).toEqual({
      supported: true,
      tunnelSupported: true,
      pushTokenSupported: true,
    });
  });

  test('survives a round trip through storage', () => {
    let index = withMirroredDiscovery(emptyAgentsMirror(), 'srv-1', mirrored);
    index = { ...index, selected: { 'srv-1': 'deepseek' }, lastUsed: { 'srv-1': 'opencode' } };
    const back = parseAgentsMirrorIndex(serializeAgentsMirrorIndex(index));
    expect(back).toEqual(index);
  });

  test('a document from a newer version, or an unreadable one, is empty rather than misread', () => {
    expect(parseAgentsMirrorIndex(JSON.stringify({ version: 2, servers: { x: {} } }))).toEqual(
      emptyAgentsMirror()
    );
    expect(parseAgentsMirrorIndex('{not json')).toEqual(emptyAgentsMirror());
    expect(parseAgentsMirrorIndex(null)).toEqual(emptyAgentsMirror());
  });

  test('an id map keeps only strings, normalised', () => {
    const back = parseAgentsMirrorIndex(
      JSON.stringify({
        version: 1,
        servers: {},
        selected: { a: ' deepseek ', b: 7, c: '' },
        lastUsed: { a: 'opencode' },
      })
    );
    expect(back.selected).toEqual({ a: 'deepseek' });
    expect(back.lastUsed).toEqual({ a: 'opencode' });
  });

  test('is bounded, dropping the server that answered longest ago', () => {
    let index: AgentsMirrorIndex = emptyAgentsMirror();
    for (let i = 0; i < MAX_MIRRORED_DISCOVERY_SERVERS + 3; i += 1) {
      index = withMirroredDiscovery(index, `srv-${i}`, mirrored);
    }
    const kept = Object.keys(index.servers);
    expect(kept).toHaveLength(MAX_MIRRORED_DISCOVERY_SERVERS);
    expect(kept[0]).toBe('srv-3');
    // Answering again moves a server to the young end.
    index = withMirroredDiscovery(index, 'srv-3', mirrored);
    expect(Object.keys(index.servers).at(-1)).toBe('srv-3');
  });
});

describe('selectors for Home', () => {
  const index = withMirroredDiscovery(emptyAgentsMirror(), 'srv-1', mirrorDiscovery(discovery, 1));

  test('lists every agent in gateway order with its readiness', () => {
    expect(selectHomeAgents(index, 'srv-1').map((a) => [a.id, a.readiness])).toEqual([
      ['deepseek', 'ready'],
      ['opencode', 'offline'],
    ]);
    expect(selectHomeAgents(index, 'never-asked')).toEqual([]);
  });

  test('answers the same array while the mirror is unchanged, a new one once it changes', () => {
    const first = selectHomeAgents(index, 'srv-1');
    expect(selectHomeAgents(index, 'srv-1')).toBe(first);
    // A write that leaves this server's list alone keeps the answer.
    expect(selectHomeAgents({ ...index, selected: { 'srv-1': 'deepseek' } }, 'srv-1')).toBe(first);
    expect(selectHomeAgents(index, 'never-asked')).toBe(selectHomeAgents(index, 'other'));
    const answered = withMirroredDiscovery(index, 'srv-1', mirrorDiscovery(discovery, 2));
    expect(selectHomeAgents(answered, 'srv-1')).not.toBe(first);
    expect(selectHomeAgents(answered, 'srv-1')).toEqual(first);
  });

  test('the selected agent is the pick, the last used, or the first ready one', () => {
    expect(selectedAgentFor(index, 'srv-1')).toBe('deepseek');
    expect(selectedAgentFor({ ...index, lastUsed: { 'srv-1': 'opencode' } }, 'srv-1')).toBe(
      'deepseek'
    );
    expect(selectedAgentFor(index, 'never-asked')).toBe(DEFAULT_AGENT_ID);
    expect(lastUsedAgent({ ...index, lastUsed: { 'srv-1': 'opencode' } }, 'srv-1')).toBe(
      'opencode'
    );
    expect(serverOffersAgentChoice(index, 'srv-1')).toBe(false);
  });
});
