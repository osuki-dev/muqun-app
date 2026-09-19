import { describe, expect, test } from 'bun:test';

import type { AgentInfo, AgentSessionInfo, ModelInfo } from '../agent-protocol';
import {
  catalogAgentId,
  catalogModelRef,
  effectiveAgentId,
  firstUsableModel,
  recentSessionChoice,
  resolveNewSessionDefaults,
  unsupportedModelRefs,
} from '../agent-session-defaults';

const models: ModelInfo[] = [
  {
    id: 'union-alpha',
    name: 'Union Alpha',
    provider_id: 'opencode',
    enabled: true,
    variants: [{ id: 'thinking' }],
  },
  { id: 'nemotron-3.5', name: 'Nemotron 3.5', provider_id: 'deepseek', enabled: true },
  { id: 'switched-off', name: 'Switched Off', provider_id: 'openai', enabled: false },
  { id: 'spark-free', name: 'Spark Free', provider_id: 'opencode', enabled: true },
];

const agents: AgentInfo[] = [
  { id: 'build', name: 'Build' },
  { id: 'plan', name: 'Plan' },
  { id: 'nested', name: 'Nested', mode: 'subagent' },
  { id: 'secret', name: 'Secret', hidden: true },
];

const alpha = { provider_id: 'opencode', model_id: 'union-alpha' };
const nemotron = { provider_id: 'deepseek', model_id: 'nemotron-3.5' };
const free = { provider_id: 'opencode', model_id: 'spark-free' };

function session(over: Partial<AgentSessionInfo>): AgentSessionInfo {
  return {
    asid: 'asid',
    backend_session_id: 'backend',
    title: '',
    model: null,
    status: 'idle',
    updated_ms: 0,
    ...over,
  };
}

describe('catalogModelRef', () => {
  test('a model the catalog lists survives', () => {
    expect(catalogModelRef(alpha, models)).toEqual(alpha);
  });

  test('a model the catalog no longer lists is dropped', () => {
    expect(catalogModelRef({ provider_id: 'opencode', model_id: 'gone' }, models)).toBeUndefined();
  });

  test('the same id under an unconfigured provider is not the same model', () => {
    expect(
      catalogModelRef({ provider_id: 'nowhere', model_id: 'union-alpha' }, models)
    ).toBeUndefined();
  });

  test('a model the host switched off is dropped', () => {
    expect(
      catalogModelRef({ provider_id: 'openai', model_id: 'switched-off' }, models)
    ).toBeUndefined();
  });

  test('a listed variant is kept', () => {
    expect(catalogModelRef({ ...alpha, variant: 'thinking' }, models)).toEqual({
      ...alpha,
      variant: 'thinking',
    });
  });

  test('a variant that went away costs the variant, not the model', () => {
    expect(catalogModelRef({ ...alpha, variant: 'turbo' }, models)).toEqual(alpha);
    expect(catalogModelRef({ ...nemotron, variant: 'thinking' }, models)).toEqual(nemotron);
  });

  test('an empty catalog verifies nothing', () => {
    expect(catalogModelRef(alpha, [])).toBeUndefined();
  });
});

describe('catalogAgentId', () => {
  test('an agent the picker offers survives', () => {
    expect(catalogAgentId('plan', agents)).toBe('plan');
  });

  test('an agent that vanished, is hidden, or is a subagent is dropped', () => {
    expect(catalogAgentId('gone', agents)).toBeUndefined();
    expect(catalogAgentId('secret', agents)).toBeUndefined();
    expect(catalogAgentId('nested', agents)).toBeUndefined();
  });

  test('an empty catalog verifies nothing', () => {
    expect(catalogAgentId('build', [])).toBeUndefined();
  });
});

describe('resolveNewSessionDefaults', () => {
  test('nothing to go on still sends a model the host can run', () => {
    // Not `{}`: a host with no default configured runs the first entry of its
    // own list, which is how "Model jev-latest is not supported" happened.
    expect(resolveNewSessionDefaults({ picked: {}, models, agents })).toEqual({ model: free });
  });

  test('an empty catalog is the one case that sends nothing', () => {
    expect(resolveNewSessionDefaults({ picked: {}, models: [], agents: [] })).toEqual({});
  });

  test('a pick made in this run outranks everything remembered', () => {
    expect(
      resolveNewSessionDefaults({
        picked: { model: alpha, agent: 'plan' },
        workspace: { model: nemotron, agent: 'build' },
        server: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: alpha, agent: 'plan' });
  });

  test('the workspace outranks the server-wide fallback', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: alpha, agent: 'plan' },
        server: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: alpha, agent: 'plan' });
  });

  test('a workspace never used before falls back to the server-wide pick', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        server: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: nemotron, agent: 'build' });
  });

  test('model and agent are resolved one at a time', () => {
    // Picking a model in a workspace says nothing about which agent belongs
    // there, so the agent keeps falling through on its own.
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: alpha },
        server: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: alpha, agent: 'build' });
  });

  test('a remembered model the catalog dropped falls through instead of ending the chain', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: { provider_id: 'opencode', model_id: 'retired' }, agent: 'retired' },
        server: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: nemotron, agent: 'build' });
  });

  test('a remembered model no catalog confirms is never sent', () => {
    // It falls all the way to the catalog's own free model rather than being
    // sent to a host that no longer has it.
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: { provider_id: 'opencode', model_id: 'retired' }, agent: 'retired' },
        models,
        agents,
      })
    ).toEqual({ model: free });
  });
});

describe('recentSessionChoice', () => {
  test('the newest session answers', () => {
    const list = [
      session({ asid: 'old', model: alpha, agent: 'build', updated_ms: 10 }),
      session({ asid: 'new', model: nemotron, agent: 'plan', updated_ms: 20 }),
    ];
    expect(recentSessionChoice(list)).toEqual({ model: nemotron, agent: 'plan' });
  });

  test('each field is read from the newest session that has one', () => {
    const list = [
      session({ asid: 'old', model: alpha, agent: 'build', updated_ms: 10 }),
      session({ asid: 'new', model: nemotron, updated_ms: 20 }),
    ];
    expect(recentSessionChoice(list)).toEqual({ model: nemotron, agent: 'build' });
  });

  test('a workspace is answered by its own sessions', () => {
    const list = [
      session({ asid: 'here', model: alpha, updated_ms: 10, directory: '/work/app' }),
      session({ asid: 'elsewhere', model: nemotron, updated_ms: 20, directory: '/work/notes' }),
    ];
    expect(recentSessionChoice(list, '/work/app')).toEqual({ model: alpha });
    expect(recentSessionChoice(list, '/work/nowhere')).toEqual({});
    expect(recentSessionChoice(list)).toEqual({ model: nemotron });
  });

  test('a session that died on its own model is not evidence that model works', () => {
    const list = [
      session({ asid: 'ok', model: alpha, updated_ms: 10 }),
      session({
        asid: 'broken',
        model: { provider_id: 'opencode', model_id: 'jev-latest' },
        updated_ms: 20,
        status: 'failed',
        error: { name: 'error', message: 'Model jev-latest is not supported' },
      }),
    ];
    expect(recentSessionChoice(list)).toEqual({ model: alpha });
  });
});

describe('firstUsableModel', () => {
  test('free before paid, whatever the list order', () => {
    expect(firstUsableModel(models)).toEqual(free);
  });

  test('paid rather than nothing when the host publishes no free model', () => {
    const paid = models.filter((model) => model.id !== 'spark-free');
    expect(firstUsableModel(paid)).toEqual(alpha);
  });

  test('a model the host switched off is not usable', () => {
    expect(firstUsableModel([{ ...models[2]! }])).toBeUndefined();
  });

  test('an empty catalog has nothing to offer', () => {
    expect(firstUsableModel([])).toBeUndefined();
  });
});

describe('the rungs below memory', () => {
  const sessions = [
    session({ asid: 'here', model: alpha, agent: 'plan', updated_ms: 10, directory: '/work/app' }),
    session({
      asid: 'elsewhere',
      model: nemotron,
      agent: 'build',
      updated_ms: 20,
      directory: '/work/notes',
    }),
  ];

  test('a device with no memory follows the sessions in this workspace', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        sessions,
        directory: '/work/app',
        models,
        agents,
      })
    ).toEqual({ model: alpha, agent: 'plan' });
  });

  test('a workspace with no sessions of its own follows the newest anywhere', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        sessions,
        directory: '/work/fresh',
        models,
        agents,
      })
    ).toEqual({ model: nemotron, agent: 'build' });
  });

  test('memory outranks the sessions on the host', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: free },
        sessions,
        directory: '/work/app',
        models,
        agents,
      })
    ).toEqual({ model: free, agent: 'plan' });
  });

  test("the catalog's defaults answer when there are no sessions", () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        catalogDefaults: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: nemotron, agent: 'build' });
  });

  test('a stale catalog default is checked like everything else', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        catalogDefaults: { model: { provider_id: 'opencode', model_id: 'retired' } },
        models,
        agents,
      })
    ).toEqual({ model: free });
  });

  test('sessions outrank the catalog default', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        sessions,
        directory: '/work/app',
        catalogDefaults: { model: nemotron, agent: 'build' },
        models,
        agents,
      })
    ).toEqual({ model: alpha, agent: 'plan' });
  });

  test('the agent may be omitted even when the model may not', () => {
    // OpenCode's fallback agent is its primary agent, which is a real default;
    // its fallback model is whatever sorted first, which is not.
    expect(resolveNewSessionDefaults({ picked: {}, models, agents: [] })).toEqual({ model: free });
  });
});

describe("a project's own agent", () => {
  /**
   * What a workspace-scoped catalog answers with once `?directory=` is sent:
   * the host's agents *and* the one defined under the project's own
   * `.opencode/agent`. Nothing downstream may treat it as second class.
   */
  const withCustom: AgentInfo[] = [
    ...agents,
    {
      id: 'osuki-coder',
      name: 'osuki-coder',
      mode: 'primary',
      hidden: false,
      description: 'The house style, the house checks, and nothing else.',
    },
  ];

  test('it is a choice a session can be remembered on', () => {
    expect(catalogAgentId('osuki-coder', withCustom)).toBe('osuki-coder');
    // And it is not invented: an agent this catalog does not list is dropped,
    // so a memory from another workspace cannot be sent to this one.
    expect(catalogAgentId('osuki-coder', agents)).toBeUndefined();
  });

  test('a session running it marks it as the current row', () => {
    expect(effectiveAgentId('osuki-coder', 'build')).toBe('osuki-coder');
    expect(
      withCustom.find((agent) => agent.id === effectiveAgentId('osuki-coder', 'build'))
    ).toMatchObject({ id: 'osuki-coder', name: 'osuki-coder' });
  });

  test("the host's default is the current row when nobody has picked", () => {
    expect(effectiveAgentId(undefined, 'osuki-coder')).toBe('osuki-coder');
    expect(effectiveAgentId(undefined, undefined)).toBe('build');
    expect(effectiveAgentId('  ', '  ')).toBe('build');
  });
});

describe('a default this server has already refused', () => {
  /**
   * The host answers `defaults.model` with `opencode/jev-latest` -- OpenCode's
   * list-order fallback on a host with no default configured -- and then
   * refuses every turn on it with "Model jev-latest is not supported". The
   * rung stays; what changes is that a preference the server has already
   * proved it cannot honour is no longer treated as one.
   */
  const jev = { provider_id: 'opencode', model_id: 'jev-latest' };
  const withJev: ModelInfo[] = [
    { id: 'jev-latest', name: 'Jev', provider_id: 'opencode', enabled: true },
    ...models,
  ];
  const failed = [
    session({
      asid: 'failed',
      model: jev,
      updated_ms: 30,
      error: { name: 'error', message: 'Model jev-latest is not supported' },
    }),
  ];

  test('the refusal is read off the sessions, in the host\u2019s own words', () => {
    expect(unsupportedModelRefs(failed).has('opencode\u0000jev-latest')).toBe(true);
    expect(unsupportedModelRefs([session({ asid: 'fine', model: jev })]).size).toBe(0);
  });

  test('it falls through to the next rung rather than starting another dead session', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        sessions: failed,
        catalogDefaults: { model: jev },
        models: withJev,
        agents,
      }).model
    ).toEqual(free);
  });

  test('the guess below it does not hand back the same refused model either', () => {
    expect(firstUsableModel(withJev, unsupportedModelRefs(failed))).toEqual(free);
    expect(firstUsableModel([withJev[0]!], unsupportedModelRefs(failed))).toBeUndefined();
  });

  test('a default that has never failed here is still what a new session starts on', () => {
    expect(
      resolveNewSessionDefaults({
        picked: {},
        sessions: [],
        catalogDefaults: { model: jev },
        models: withJev,
        agents,
      }).model
    ).toEqual(jev);
  });
});
