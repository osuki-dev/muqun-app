import { describe, expect, test } from 'bun:test';

import type { AgentInfo, ModelInfo } from '../agent-protocol';
import {
  catalogAgentId,
  catalogModelRef,
  resolveNewSessionDefaults,
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
];

const agents: AgentInfo[] = [
  { id: 'build', name: 'Build' },
  { id: 'plan', name: 'Plan' },
  { id: 'nested', name: 'Nested', mode: 'subagent' },
  { id: 'secret', name: 'Secret', hidden: true },
];

const alpha = { provider_id: 'opencode', model_id: 'union-alpha' };
const nemotron = { provider_id: 'deepseek', model_id: 'nemotron-3.5' };

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
  test('nothing remembered and nothing picked sends nothing', () => {
    // Omitting `model` is how a new session gets the user's configured default.
    expect(resolveNewSessionDefaults({ picked: {}, models, agents })).toEqual({});
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
    expect(
      resolveNewSessionDefaults({
        picked: {},
        workspace: { model: { provider_id: 'opencode', model_id: 'retired' }, agent: 'retired' },
        models,
        agents,
      })
    ).toEqual({});
  });
});
