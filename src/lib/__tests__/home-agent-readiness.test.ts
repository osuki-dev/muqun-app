import { describe, expect, test } from 'bun:test';

import { EMPTY_CATALOG, parseGatewayDiscovery } from '../agent-protocol';
import {
  agentGuideBlurb,
  checkAgentReadiness,
  showsAgentSetupCommand,
  type AgentReadinessPorts,
} from '../home-agent-readiness';

function ports(overrides: Partial<AgentReadinessPorts> = {}): AgentReadinessPorts {
  return {
    probeHealth: async () => ({ ok: true, capabilities: ['agent_sessions'] }),
    loadCatalog: async () => ({
      ...EMPTY_CATALOG,
      models: [{ id: 'model', name: 'Model', provider_id: 'provider', enabled: true }],
    }),
    loadProjects: async () => [],
    ...overrides,
  };
}

describe('OpenCode readiness', () => {
  test('reports a health failure without asking catalog APIs', async () => {
    let catalogCalls = 0;
    let projectCalls = 0;
    const result = await checkAgentReadiness(
      ports({
        probeHealth: async () => ({ ok: false }),
        loadCatalog: async () => {
          catalogCalls += 1;
          return EMPTY_CATALOG;
        },
        loadProjects: async () => {
          projectCalls += 1;
          return [];
        },
      })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: [],
      agentId: 'opencode',
      cause: 'health',
    });
    expect(catalogCalls).toBe(0);
    expect(projectCalls).toBe(0);
  });

  test('distinguishes a healthy gateway without the advertised capability', async () => {
    const result = await checkAgentReadiness(
      ports({ probeHealth: async () => ({ ok: true, capabilities: ['agent_spawn'] }) })
    );

    expect(result).toEqual({
      status: 'unsupported',
      capabilities: ['agent_spawn'],
      agentId: 'opencode',
    });
  });

  test('requires both server-scoped catalog reads after capability detection', async () => {
    const calls: string[] = [];
    const result = await checkAgentReadiness(
      ports({
        loadCatalog: async () => {
          calls.push('catalog');
          return {
            ...EMPTY_CATALOG,
            models: [{ id: 'model', name: 'Model', provider_id: 'provider', enabled: true }],
          };
        },
        loadProjects: async () => {
          calls.push('projects');
          return [];
        },
      })
    );

    expect(result).toEqual({
      status: 'ready',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
    });
    expect(calls.sort()).toEqual(['catalog', 'projects']);
  });

  test('uses explicit engine installation evidence before probing catalogs', async () => {
    let catalogCalls = 0;
    const result = await checkAgentReadiness(
      ports({
        loadStatus: async () => ({
          available: false,
          installation: 'not_found',
          origin: 'none',
          stream_connected: false,
          autostart: true,
        }),
        loadCatalog: async () => {
          catalogCalls += 1;
          return EMPTY_CATALOG;
        },
      })
    );

    expect(result).toEqual({
      status: 'not-installed',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
    });
    expect(catalogCalls).toBe(0);
  });

  test('distinguishes an installed binary whose service is unavailable', async () => {
    const result = await checkAgentReadiness(
      ports({
        loadStatus: async () => ({
          available: false,
          installation: 'installed',
          origin: 'none',
          stream_connected: false,
          autostart: true,
        }),
      })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
      cause: 'service',
    });
  });

  test('keeps the older-gateway catalog fallback when installation is unknown', async () => {
    const result = await checkAgentReadiness(
      ports({
        loadStatus: async () => null,
      })
    );

    expect(result).toEqual({
      status: 'ready',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
    });
  });

  test('reports a catalog failure as offline while retaining health capabilities', async () => {
    const result = await checkAgentReadiness(
      ports({ loadCatalog: async () => Promise.reject(new Error('service starting')) })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
      cause: 'catalog',
    });
  });

  test('treats an empty catalog and project list as setup still required', async () => {
    const result = await checkAgentReadiness(
      ports({ loadCatalog: async () => EMPTY_CATALOG, loadProjects: async () => [] })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: ['agent_sessions'],
      agentId: 'opencode',
      cause: 'catalog',
    });
  });
});

describe('agents discovery', () => {
  const discovery = (agents: Record<string, { status: string; enabled?: boolean }>) =>
    parseGatewayDiscovery({
      planes: {
        agents: {
          supported: true,
          agents: Object.entries(agents).map(([id, entry]) => ({
            id,
            name: id,
            kind: id,
            status: entry.status,
            enabled: entry.enabled ?? true,
          })),
          features: {},
        },
      },
    });
  const multi = () => ({
    probeHealth: async () => ({ ok: true, capabilities: ['agent_sessions', 'multi_agent'] }),
  });

  test('is not asked of a gateway without the capability', async () => {
    let asked = 0;
    const result = await checkAgentReadiness(
      ports({
        loadDiscovery: async () => {
          asked += 1;
          return discovery({ opencode: { status: 'connected' } });
        },
      })
    );
    expect(asked).toBe(0);
    expect(result).toMatchObject({ status: 'ready', agentId: 'opencode' });
  });

  test('answers from discovery for the first ready agent, and names it', async () => {
    let catalogCalls = 0;
    const result = await checkAgentReadiness(
      ports({
        ...multi(),
        loadDiscovery: async () =>
          discovery({ deepseek: { status: 'reachable' }, opencode: { status: 'offline' } }),
        loadCatalog: async () => {
          catalogCalls += 1;
          return EMPTY_CATALOG;
        },
      })
    );
    expect(result).toMatchObject({ status: 'ready', agentId: 'deepseek' });
    expect(result.discovery?.agents?.agents).toHaveLength(2);
    expect(catalogCalls).toBe(0);
  });

  test.each([
    ['not_installed', 'not-installed'],
    ['disabled', 'unsupported'],
    ['unconfigured', 'needs-setup'],
    ['offline', 'offline'],
  ] as const)('%s on the agent asked for is %s', async (status, expected) => {
    const result = await checkAgentReadiness(
      ports({ ...multi(), loadDiscovery: async () => discovery({ opencode: { status } }) }),
      'opencode'
    );
    expect(result.status).toBe(expected);
    expect(result.agentId).toBe('opencode');
    if (result.status === 'offline') expect(result.cause).toBe('service');
  });

  test('an agent the gateway does not list is unsupported', async () => {
    const result = await checkAgentReadiness(
      ports({
        ...multi(),
        loadDiscovery: async () => discovery({ opencode: { status: 'connected' } }),
      }),
      't3'
    );
    expect(result).toMatchObject({ status: 'unsupported', agentId: 't3' });
  });

  test('a discovery that fails keeps the single-agent path', async () => {
    const result = await checkAgentReadiness(
      ports({
        ...multi(),
        loadDiscovery: async () => {
          throw new Error('refused');
        },
      })
    );
    expect(result).toMatchObject({ status: 'ready', agentId: 'opencode' });
    expect(result.discovery).toBeUndefined();
  });
});

describe('what the guide says', () => {
  const common = { capabilities: [], agentId: 't3' };

  test("an agent that needs setup gets its kind's start sentence and command", () => {
    const readiness = { status: 'needs-setup', ...common } as const;
    expect(agentGuideBlurb(readiness)).toBe('setup');
    expect(showsAgentSetupCommand(readiness)).toBe(true);
  });

  test('a stopped service gets the same, a dead gateway does not', () => {
    expect(agentGuideBlurb({ status: 'offline', cause: 'service', ...common })).toBe('setup');
    expect(showsAgentSetupCommand({ status: 'offline', cause: 'service', ...common })).toBe(true);
    expect(agentGuideBlurb({ status: 'offline', cause: 'health', ...common })).toBe('health');
    expect(showsAgentSetupCommand({ status: 'offline', cause: 'health', ...common })).toBe(false);
    expect(agentGuideBlurb({ status: 'offline', cause: 'catalog', ...common })).toBe('unconfirmed');
  });

  test('unsupported stays unsupported, with nothing to run', () => {
    const readiness = { status: 'unsupported', ...common } as const;
    expect(agentGuideBlurb(readiness)).toBe('unsupported');
    expect(showsAgentSetupCommand(readiness)).toBe(false);
  });
});
