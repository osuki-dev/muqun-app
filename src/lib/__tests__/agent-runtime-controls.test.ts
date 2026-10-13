import { describe, expect, test } from 'bun:test';
import {
  canSendAgentPrompt,
  confirmedAgentModel,
  stagedAgentModelFor,
} from '../agent-runtime-controls';
import type { AgentSessionInfo, ModelRef } from '../agent-protocol';

const actual: ModelRef = { provider_id: 'openai', model_id: 'confirmed', variant: 'low' };
const requested: ModelRef = { provider_id: 'openai', model_id: 'requested', variant: 'high' };
const session: AgentSessionInfo = {
  asid: 'thread',
  backend_session_id: 'native-thread',
  agent_id: 'codex',
  title: '',
  status: 'idle',
  updated_ms: 1,
  model: actual,
};
const staged = {
  serverId: 'gateway',
  asid: 'thread',
  gatewayGeneration: 'run-one',
  model: requested,
};

describe('runtime prompt delivery', () => {
  test('ordinary messages wait while a runtime without an inbox is running', () => {
    expect(canSendAgentPrompt(true, false)).toBe(false);
    expect(canSendAgentPrompt(false, false)).toBe(true);
  });
  test('inbox runtimes retain running delivery', () => {
    expect(canSendAgentPrompt(true, true)).toBe(true);
    expect(canSendAgentPrompt(false, true)).toBe(true);
  });
});

describe('next-turn model selection', () => {
  test('staging is separate from the model and effort confirmed by the source', () => {
    expect(stagedAgentModelFor(staged, 'gateway', 'thread', 'run-one')).toBe(requested);
    expect(confirmedAgentModel('thread', session, { ...session, model: requested })).toBe(actual);
  });
  test('source normalization replaces the actual model without copying the staged request', () => {
    const normalized = { ...actual, model_id: 'normalized', variant: 'medium' };
    expect(
      confirmedAgentModel('thread', { ...session, status: 'busy', model: normalized }, session)
    ).toBe(normalized);
  });
  test('a source without model information does not fall back to an outdated list model', () => {
    expect(confirmedAgentModel('thread', { ...session, model: null }, session)).toBeUndefined();
    expect(confirmedAgentModel('thread', null, session)).toBe(actual);
    expect(confirmedAgentModel('other', session, session)).toBeUndefined();
  });
  test('Gateway restarts invalidate staging without invalidating native session metadata', () => {
    expect(stagedAgentModelFor(staged, 'gateway', 'thread', 'run-two')).toBeUndefined();
    expect(confirmedAgentModel('thread', session, null)).toBe(actual);
  });
  test('staging cannot cross Gateway or thread identities', () => {
    expect(stagedAgentModelFor(staged, 'other', 'thread', 'run-one')).toBeUndefined();
    expect(stagedAgentModelFor(staged, 'gateway', 'other', 'run-one')).toBeUndefined();
    expect(stagedAgentModelFor(staged, 'gateway', undefined, 'run-one')).toBeUndefined();
  });
});
