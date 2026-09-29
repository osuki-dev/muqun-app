import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionInfo,
  parseAgentsDiscovery,
  parseAgentStatusInfo,
  parseGatewayDiscovery,
} from '../agent-protocol';

/**
 * The agent dimension of the wire contract: `agent_id` and `mode` on a
 * session, `agent_id` and `kind` on the status route, and the agents plane of
 * `GET /api/discovery`, which is camelCase where the rest of the agent API is
 * snake_case.
 */

describe('a session names its agent', () => {
  test('reads `agent_id` and `mode`', () => {
    const info = parseAgentSessionInfo({
      asid: 'ses_1',
      agent_id: 'deepseek',
      mode: 'default',
      title: 'Port the parser',
      status: 'idle',
      updated_ms: 3,
    });
    expect(info?.agent_id).toBe('deepseek');
    expect(info?.mode).toBe('default');
  });

  test('a gateway that says nothing, or an empty string, is the default agent', () => {
    expect(parseAgentSessionInfo({ asid: 'a', status: 'idle' })?.agent_id).toBe(DEFAULT_AGENT_ID);
    expect(parseAgentSessionInfo({ asid: 'a', agent_id: '' })?.agent_id).toBe(DEFAULT_AGENT_ID);
    expect(parseAgentSessionInfo({ asid: 'a', agent_id: 7 })?.agent_id).toBe(DEFAULT_AGENT_ID);
    expect(normalizeAgentId('  t3 ')).toBe('t3');
  });
});

describe('the status route', () => {
  test('carries which agent answered and its kind', () => {
    const status = parseAgentStatusInfo({
      available: true,
      installation: 'installed',
      origin: 'adopted',
      url: 'http://127.0.0.1:4200',
      stream_connected: true,
      autostart: false,
      agent_id: 'deepseek',
      kind: 'deepseek',
    });
    expect(status).toMatchObject({ available: true, agent_id: 'deepseek', kind: 'deepseek' });
  });

  test('an older gateway leaves both out', () => {
    const status = parseAgentStatusInfo({ available: false, origin: 'none' });
    expect(Object.keys(status ?? {})).not.toContain('agent_id');
    expect(Object.keys(status ?? {})).not.toContain('kind');
  });
});

describe('the agents plane', () => {
  const plane = {
    supported: true,
    agents: [
      {
        id: 'opencode',
        name: 'OpenCode',
        kind: 'opencode',
        status: 'connected',
        enabled: true,
        endpoint: 'http://127.0.0.1:4096',
        version: '2.0.1',
        models: [
          {
            id: 'union-alpha',
            name: 'Union Alpha',
            providerId: 'opencode',
            supportsReasoning: false,
          },
        ],
        modes: [{ id: 'build', name: 'Build' }],
        features: {
          streaming: true,
          reasoningEffort: false,
          modelSelection: true,
          toolApprovals: true,
          worktrees: true,
          revert: true,
          inbox: true,
          somethingNew: 'yes',
        },
      },
      {
        id: 'deepseek',
        name: 'DeepSeek Harness',
        kind: 'deepseek',
        status: 'not_installed',
        enabled: false,
        models: [],
        modes: [],
        features: {},
      },
      { name: 'no id, no row' },
      { id: 'opencode', name: 'a duplicate, dropped' },
    ],
    features: { multiAgent: true, catalogAggregation: true, sessionRouting: false },
  };

  test('reads the plane from the whole answer, from `planes`, and on its own', () => {
    const whole = parseAgentsDiscovery({ ok: true, planes: { agents: plane, terminal: {} } });
    const wrapped = parseAgentsDiscovery({ data: { ok: true, planes: { agents: plane } } });
    const planes = parseAgentsDiscovery({ agents: plane, terminal: {} });
    const alone = parseAgentsDiscovery(plane);
    expect(whole).toEqual(alone);
    expect(wrapped).toEqual(alone);
    expect(planes).toEqual(alone);
    expect(alone?.agents.map((agent) => agent.id)).toEqual(['opencode', 'deepseek']);
    expect(alone).toMatchObject({
      supported: true,
      multiAgent: true,
      catalogAggregation: true,
      sessionRouting: false,
    });
  });

  test('keeps endpoint, version, models and modes when they are sent', () => {
    const opencode = parseAgentsDiscovery(plane)?.agents[0];
    expect(opencode).toMatchObject({
      endpoint: 'http://127.0.0.1:4096',
      version: '2.0.1',
      status: 'connected',
      enabled: true,
    });
    expect(opencode?.models).toEqual([
      {
        id: 'union-alpha',
        name: 'Union Alpha',
        providerId: 'opencode',
        supportsReasoning: false,
        reasoningEffortTiers: [],
      },
    ]);
    expect(opencode?.modes).toEqual([{ id: 'build', name: 'Build' }]);
    expect(opencode?.features.extra).toEqual({ somethingNew: 'yes' });
    expect(opencode?.features.reasoningEffort).toBe(false);
  });

  test('a flag the gateway left out is the kind default', () => {
    const deepseek = parseAgentsDiscovery(plane)?.agents[1];
    expect(deepseek?.status).toBe('not_installed');
    expect(deepseek?.enabled).toBe(false);
    expect(deepseek?.features.revert).toBe(false);
    expect(deepseek?.features.streaming).toBe(true);
    const unredacted = parseAgentsDiscovery({
      agents: [{ id: 'opencode', status: 'connected', features: {} }],
    });
    expect(unredacted?.agents[0]?.features.worktrees).toBe(true);
    expect(unredacted?.agents[0]?.enabled).toBe(true);
    expect(Object.keys(unredacted?.agents[0] ?? {})).not.toContain('endpoint');
  });

  test('a status this build has never heard of is `unknown`, not a crash', () => {
    const parsed = parseAgentsDiscovery({
      agents: [{ id: 'x', status: 'hibernating', features: null }],
    });
    expect(parsed?.agents[0]?.status).toBe('unknown');
    expect(parsed?.supported).toBe(false);
  });

  test('nothing that is not an agents plane reads as one', () => {
    expect(parseAgentsDiscovery(null)).toBeNull();
    expect(parseAgentsDiscovery({ ok: true, capabilities: [] })).toBeNull();
    expect(parseAgentsDiscovery({ planes: { terminal: { backends: [] } } })).toBeNull();
    expect(parseAgentsDiscovery({ agents: 'nope' })).toBeNull();
  });
});

describe('the whole discovery answer', () => {
  test('reads the terminal and SSH planes beside the agents', () => {
    const parsed = parseGatewayDiscovery({
      ok: true,
      planes: {
        terminal: {
          supported: true,
          mode: 'herdr',
          activeBackend: 'main',
          backends: [
            { sessionId: 'main', label: 'main', kind: 'herdr', connected: true, capabilities: [] },
            { label: 'no session id, no row' },
          ],
          degradedReason: 'one backend down',
        },
        agents: { supported: false, agents: [], features: {} },
        ssh: { supported: true, tunnelSupported: true, pushTokenSupported: false },
      },
    });
    expect(parsed.terminal).toEqual({
      supported: true,
      mode: 'herdr',
      activeBackend: 'main',
      backends: [
        { sessionId: 'main', label: 'main', kind: 'herdr', connected: true, capabilities: [] },
      ],
      degradedReason: 'one backend down',
    });
    expect(parsed.ssh).toEqual({
      supported: true,
      tunnelSupported: true,
      pushTokenSupported: false,
    });
    expect(parsed.agents).toMatchObject({ supported: false, agents: [], multiAgent: false });
  });

  test('an answer without planes has no planes, and is not an error', () => {
    expect(parseGatewayDiscovery({ ok: true })).toEqual({
      agents: null,
      terminal: null,
      ssh: null,
    });
    expect(parseGatewayDiscovery('nope')).toEqual({ agents: null, terminal: null, ssh: null });
  });
});
