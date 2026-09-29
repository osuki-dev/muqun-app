import { describe, expect, test } from 'bun:test';

import type { MirroredAgent, MirroredServerDiscovery } from '../agent-discovery';
import { defaultAgentFeatures, type AgentAvailability } from '../agent-protocol';
import {
  agentDisplayName,
  buildLaunchModel,
  groupLaunchCells,
  projectLaunchAgents,
  type LaunchEntry,
} from '../home-launch-model';

function agent(
  id: string,
  status: AgentAvailability = 'connected',
  extra: Partial<MirroredAgent> = {}
): MirroredAgent {
  return {
    id,
    kind: id,
    name: id === 'opencode' ? 'OpenCode' : id === 'deepseek' ? 'DeepSeek' : id.toUpperCase(),
    status,
    enabled: true,
    features: defaultAgentFeatures(),
    ...extra,
  };
}

function mirror(
  agents: MirroredAgent[] | null,
  extra: Partial<MirroredServerDiscovery> = {}
): MirroredServerDiscovery {
  return {
    agents: agents
      ? {
          supported: true,
          agents,
          multiAgent: agents.length > 1,
          catalogAggregation: true,
          sessionRouting: true,
        }
      : null,
    terminal: null,
    ssh: null,
    observedAtMs: 0,
    ...extra,
  };
}

const ids = (entries: LaunchEntry[]) => entries.map((entry) => entry.testID);
const markers = (entries: LaunchEntry[]) => entries.map((entry) => entry.marker);

describe('the fixed row', () => {
  const today = [
    'home-new-agent-opencode',
    'home-open-sessions',
    'home-open-terminal',
    'home-new-terminal',
    'home-open-ssh',
  ];

  test("no discovery is exactly the five tiles in today's order", () => {
    const model = buildLaunchModel();
    expect(model.source).toBe('fallback');
    expect(ids(model.entries)).toEqual(today);
    expect(markers(model.entries)).toEqual(['01', '02', '03', '04', '05']);
    const [first, sessions] = model.entries;
    expect(first).toMatchObject({ kind: 'agent', primary: true, name: 'OpenCode' });
    expect(first).toMatchObject({ aliasTestID: 'home-new-opencode', caption: 'new-session' });
    // The fallback tile goes to the server's own choice, not to a named agent.
    expect(first && 'agentId' in first ? first.agentId : 'absent').toBe('absent');
    expect(sessions).toMatchObject({ aliasTestID: 'home-open-opencode' });
  });

  test('a mirror without an agents plane, or with an empty one, is the fixed row too', () => {
    expect(ids(buildLaunchModel({ discovery: mirror(null) }).entries)).toEqual(today);
    expect(ids(buildLaunchModel({ discovery: mirror([]) }).entries)).toEqual(today);
  });
});

describe('a projected row', () => {
  test('one agent: its own name, one primary tile, then the rest of the row', () => {
    const model = buildLaunchModel({ discovery: mirror([agent('deepseek')]) });
    expect(model.source).toBe('discovery');
    expect(ids(model.entries)).toEqual([
      'home-new-agent-deepseek',
      'home-open-sessions',
      'home-open-terminal',
      'home-new-terminal',
      'home-open-ssh',
    ]);
    expect(model.entries[0]).toMatchObject({
      kind: 'agent',
      agentId: 'deepseek',
      agentKind: 'deepseek',
      name: 'DeepSeek',
      primary: true,
      caption: 'new-session',
    });
    expect('aliasTestID' in model.entries[0]!).toBe(false);
  });

  test('three agents keep gateway order and only the first is primary', () => {
    const model = buildLaunchModel({
      discovery: mirror([agent('opencode'), agent('deepseek'), agent('t3')]),
    });
    expect(ids(model.entries).slice(0, 4)).toEqual([
      'home-new-agent-opencode',
      'home-new-agent-deepseek',
      'home-new-agent-t3',
      'home-open-sessions',
    ]);
    expect(model.entries.map((e) => (e.kind === 'agent' ? e.primary : null)).slice(0, 3)).toEqual([
      true,
      false,
      false,
    ]);
    expect(model.entries[0]).toMatchObject({ aliasTestID: 'home-new-opencode' });
    expect(markers(model.entries)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
    expect(ids(model.entries)).not.toContain('home-more-agents');
  });

  test('five agents collapse to three plus a More agents tile', () => {
    const model = buildLaunchModel({
      discovery: mirror(['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => agent(id))),
    });
    expect(ids(model.entries)).toEqual([
      'home-new-agent-a1',
      'home-new-agent-a2',
      'home-new-agent-a3',
      'home-more-agents',
      'home-open-sessions',
      'home-open-terminal',
      'home-new-terminal',
      'home-open-ssh',
    ]);
    expect(model.entries[3]).toMatchObject({ kind: 'more-agents', hidden: 2 });
    expect(markers(model.entries).at(-1)).toBe('08');
  });

  test('the last-used agent moves to the front and takes the primary fill', () => {
    const discovery = mirror([agent('opencode'), agent('deepseek'), agent('t3')]);
    expect(projectLaunchAgents(discovery, 't3').map((a) => a.id)).toEqual([
      't3',
      'opencode',
      'deepseek',
    ]);
    const model = buildLaunchModel({ discovery, lastUsedAgentId: 't3' });
    expect(model.entries[0]).toMatchObject({ agentId: 't3', primary: true });
    expect(model.entries[1]).toMatchObject({ agentId: 'opencode', primary: false });
    // An unknown last-used agent changes nothing.
    expect(projectLaunchAgents(discovery, 'gone').map((a) => a.id)).toEqual([
      'opencode',
      'deepseek',
      't3',
    ]);
  });

  test('disabled and unconfigured agents get no tile', () => {
    const model = buildLaunchModel({
      discovery: mirror([
        agent('opencode'),
        agent('deepseek', 'disabled'),
        agent('t3', 'unconfigured'),
        agent('gone', 'connected', { enabled: false }),
      ]),
    });
    expect(ids(model.entries).filter((id) => id.startsWith('home-new-agent'))).toEqual([
      'home-new-agent-opencode',
    ]);
  });

  test('all offline: every agent keeps an enabled tile that says why', () => {
    const model = buildLaunchModel({
      discovery: mirror([
        agent('opencode', 'offline'),
        agent('deepseek', 'not_installed'),
        agent('t3', 'unknown'),
      ]),
    });
    const captions = model.entries.flatMap((e) => (e.kind === 'agent' ? [e.caption] : []));
    expect(captions).toEqual(['offline', 'not-installed', 'offline']);
  });

  test('a reachable agent is ready to start', () => {
    const model = buildLaunchModel({ discovery: mirror([agent('opencode', 'reachable')]) });
    expect(model.entries[0]).toMatchObject({ caption: 'new-session' });
  });

  test('no offered agent drops Sessions but keeps the terminal and SSH tiles', () => {
    const model = buildLaunchModel({ discovery: mirror([agent('opencode', 'disabled')]) });
    expect(ids(model.entries)).toEqual([
      'home-open-terminal',
      'home-new-terminal',
      'home-open-ssh',
    ]);
    expect(markers(model.entries)).toEqual(['01', '02', '03']);
  });
});

describe('the terminal and SSH tiles', () => {
  const backend = (sessionId: string, kind: string, connected = true) => ({
    sessionId,
    label: sessionId,
    kind,
    connected,
    capabilities: [],
  });

  test('one backend kind names nothing; two name the active one', () => {
    const one = buildLaunchModel({
      discovery: mirror([agent('opencode')], {
        terminal: {
          supported: true,
          mode: 'auto',
          backends: [backend('a', 'herdr'), backend('b', 'herdr')],
        },
      }),
    });
    expect('backend' in one.entries.find((e) => e.kind === 'new-terminal')!).toBe(false);

    const two = buildLaunchModel({
      discovery: mirror([agent('opencode')], {
        terminal: {
          supported: true,
          mode: 'auto',
          activeBackend: 'b',
          backends: [backend('a', 'herdr'), backend('b', 'tmux')],
        },
      }),
    });
    expect(two.entries.find((e) => e.kind === 'new-terminal')).toMatchObject({ backend: 'tmux' });
  });

  test('an unsupported terminal plane hides both terminal tiles', () => {
    const model = buildLaunchModel({
      discovery: mirror([agent('opencode')], {
        terminal: { supported: false, mode: '', backends: [] },
      }),
    });
    expect(ids(model.entries)).toEqual([
      'home-new-agent-opencode',
      'home-open-sessions',
      'home-open-ssh',
    ]);
  });
});

describe('cells', () => {
  test('Sessions and Terminal stack; every other tile stands alone', () => {
    const cells = groupLaunchCells(buildLaunchModel().entries);
    expect(cells.map((cell) => cell.entries.map((e) => e.kind))).toEqual([
      ['agent'],
      ['sessions', 'terminal'],
      ['new-terminal'],
      ['ssh'],
    ]);
  });
});

describe('agent names', () => {
  test("the gateway's name wins, then the brand spelling, then the raised id", () => {
    const listed = [{ id: 'x1', kind: 'x1', name: 'Ex One' }];
    expect(agentDisplayName(listed, 'x1')).toBe('Ex One');
    expect(agentDisplayName(undefined, 'opencode')).toBe('OpenCode');
    expect(agentDisplayName(undefined, undefined)).toBe('OpenCode');
    expect(agentDisplayName([], 'zed')).toBe('Zed');
  });
});
