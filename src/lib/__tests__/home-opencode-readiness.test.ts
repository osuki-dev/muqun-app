import { describe, expect, test } from 'bun:test';

import { EMPTY_CATALOG } from '../agent-protocol';
import { checkOpenCodeReadiness, type OpenCodeReadinessPorts } from '../home-opencode-readiness';

function ports(overrides: Partial<OpenCodeReadinessPorts> = {}): OpenCodeReadinessPorts {
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
    const result = await checkOpenCodeReadiness(
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

    expect(result).toEqual({ status: 'offline', capabilities: [], cause: 'health' });
    expect(catalogCalls).toBe(0);
    expect(projectCalls).toBe(0);
  });

  test('distinguishes a healthy gateway without the advertised capability', async () => {
    const result = await checkOpenCodeReadiness(
      ports({ probeHealth: async () => ({ ok: true, capabilities: ['agent_spawn'] }) })
    );

    expect(result).toEqual({ status: 'unsupported', capabilities: ['agent_spawn'] });
  });

  test('requires both server-scoped catalog reads after capability detection', async () => {
    const calls: string[] = [];
    const result = await checkOpenCodeReadiness(
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

    expect(result).toEqual({ status: 'ready', capabilities: ['agent_sessions'] });
    expect(calls.sort()).toEqual(['catalog', 'projects']);
  });

  test('reports a catalog failure as offline while retaining health capabilities', async () => {
    const result = await checkOpenCodeReadiness(
      ports({ loadCatalog: async () => Promise.reject(new Error('service starting')) })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: ['agent_sessions'],
      cause: 'catalog',
    });
  });

  test('treats an empty catalog and project list as setup still required', async () => {
    const result = await checkOpenCodeReadiness(
      ports({ loadCatalog: async () => EMPTY_CATALOG, loadProjects: async () => [] })
    );

    expect(result).toEqual({
      status: 'offline',
      capabilities: ['agent_sessions'],
      cause: 'catalog',
    });
  });
});
