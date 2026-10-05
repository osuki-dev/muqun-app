import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionInfo,
  parseAgentsDiscovery,
  parseAgentStatusInfo,
  parseGatewayDiscovery,
  parseTransportsDiscovery,
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

  test('a flag the gateway left out is on, whatever the kind', () => {
    const deepseek = parseAgentsDiscovery(plane)?.agents[1];
    expect(deepseek?.status).toBe('not_installed');
    expect(deepseek?.enabled).toBe(false);
    expect(deepseek?.features.revert).toBe(true);
    expect(deepseek?.features.streaming).toBe(true);
    const stated = parseAgentsDiscovery({
      agents: [
        {
          id: 't3',
          status: 'connected',
          features: { modes: false, slashCommands: false, attachments: false, skills: true },
        },
      ],
    });
    expect(stated?.agents[0]?.features).toMatchObject({
      modes: false,
      slashCommands: false,
      attachments: false,
      skills: true,
      compaction: true,
    });
    expect(stated?.agents[0]?.features.extra).toEqual({});
    const unredacted = parseAgentsDiscovery({
      agents: [{ id: 'opencode', status: 'connected', features: {} }],
    });
    expect(unredacted?.agents[0]?.features.worktrees).toBe(true);
    expect(unredacted?.agents[0]?.enabled).toBe(true);
    expect(Object.keys(unredacted?.agents[0] ?? {})).not.toContain('endpoint');
  });

  test('stagedRevert is on unless the gateway says otherwise', () => {
    const older = parseAgentsDiscovery({
      agents: [{ id: 'opencode', status: 'connected', features: { revert: true } }],
    });
    expect(older?.agents[0]?.features.stagedRevert).toBe(true);
    const t3 = parseAgentsDiscovery({
      agents: [{ id: 't3', status: 'connected', features: { revert: true, stagedRevert: false } }],
    });
    expect(t3?.agents[0]?.features.revert).toBe(true);
    expect(t3?.agents[0]?.features.stagedRevert).toBe(false);
    expect(t3?.agents[0]?.features.extra).toEqual({});
  });

  test('a status this build has never heard of is `unknown`, not a crash', () => {
    const parsed = parseAgentsDiscovery({
      agents: [{ id: 'x', status: 'hibernating', features: null }],
    });
    expect(parsed?.agents[0]?.status).toBe('unknown');
    expect(parsed?.supported).toBe(false);
  });

  test('`unsupported` and its `reason` are read; a blank or non-string reason is dropped', () => {
    const reason = 'T3 server speaks orchestration protocol 2; this gateway supports 1';
    const parsed = parseAgentsDiscovery({
      agents: [
        { id: 't3', status: 'unsupported', reason },
        { id: 'a', status: 'offline', reason: 'refused' },
        { id: 'b', status: 'unsupported', reason: '  ' },
        { id: 'c', status: 'unsupported', reason: 7 },
      ],
    });
    expect(parsed?.agents[0]).toMatchObject({ status: 'unsupported', reason });
    expect(parsed?.agents[1]?.reason).toBe('refused');
    expect(parsed?.agents[2]?.status).toBe('unsupported');
    expect(parsed?.agents[2]?.reason).toBeUndefined();
    expect(parsed?.agents[3]?.reason).toBeUndefined();
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

describe('the transports', () => {
  test('the websocket path and protocol are read from the top of the answer', () => {
    const parsed = parseGatewayDiscovery({
      ok: true,
      planes: {},
      transports: { websocket: { path: '/api/ws', protocol: 1 } },
    });
    expect(parsed.transports).toEqual({ websocket: { path: '/api/ws', protocol: 1 } });
  });

  test('a protocol is optional', () => {
    expect(parseTransportsDiscovery({ websocket: { path: '/gw/ws' } })).toEqual({
      websocket: { path: '/gw/ws' },
    });
  });

  test('anything that is not an absolute path is ignored, never followed', () => {
    for (const path of ['', 'api/ws', 'wss://elsewhere/ws', '//elsewhere/ws', '/a b', 42]) {
      expect(parseTransportsDiscovery({ websocket: { path } })).toEqual({});
    }
    expect(parseTransportsDiscovery(null)).toBeNull();
    expect(parseTransportsDiscovery({ websocket: 'yes' })).toEqual({});
  });

  test('an older gateway has no transports, and no key for them', () => {
    expect('transports' in parseGatewayDiscovery({ ok: true, planes: {} })).toBe(false);
  });
});
