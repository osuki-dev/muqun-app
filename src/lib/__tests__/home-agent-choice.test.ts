import { describe, expect, test } from 'bun:test';

import type { MirroredServerDiscovery } from '../agent-discovery';
import {
  homeAgentOptions,
  parseHomeAgentChoices,
  resolveHomeAgent,
  sessionAgentKey,
  terminalAgentKey,
} from '../home-agent-choice';

function discovery(
  agents: { id: string; kind: string; name: string; status: string; enabled?: boolean }[]
): MirroredServerDiscovery {
  return {
    agents: {
      agents: agents.map((agent) => ({ enabled: true, ...agent })),
    },
  } as unknown as MirroredServerDiscovery;
}

const fleet = discovery([
  { id: 'deepseek', kind: 'deepseek', name: 'DeepSeek', status: 'unconfigured' },
  { id: 'opencode', kind: 'opencode', name: 'OpenCode', status: 'connected' },
  { id: 't3', kind: 't3', name: 'T3 Code', status: 'connected' },
]);

describe('homeAgentOptions', () => {
  test('session agents in the gateway order, then installed terminal agents', () => {
    const options = homeAgentOptions(fleet, [
      { kind: 'amp', command: 'amp', available: true },
      { kind: 'claude', command: 'claude', available: true },
      { kind: 'codex', command: 'codex', available: true },
      { kind: 'gemini', command: 'gemini', available: false },
      { kind: 'opencode', command: 'opencode', available: true },
    ]);
    expect(options.map((option) => option.key)).toEqual([
      sessionAgentKey('deepseek'),
      sessionAgentKey('opencode'),
      sessionAgentKey('t3'),
      terminalAgentKey('codex'),
      terminalAgentKey('claude'),
      terminalAgentKey('amp'),
    ]);
    expect(options.find((option) => option.key === 'terminal:claude')?.name).toBe('Claude Code');
  });

  test('a gateway that never listed agents offers OpenCode', () => {
    const options = homeAgentOptions(null, null);
    expect(options.map((option) => [option.key, option.kind, option.ready])).toEqual([
      ['session:opencode', 'session', true],
    ]);
  });
});

describe('resolveHomeAgent', () => {
  const options = homeAgentOptions(fleet, [{ kind: 'codex', command: 'codex', available: true }]);

  test('nothing chosen: the first ready agent, not the first listed', () => {
    expect(resolveHomeAgent(options, undefined)?.key).toBe('session:opencode');
  });

  test('the reader’s choice while the computer still offers it', () => {
    expect(resolveHomeAgent(options, 'terminal:codex')?.key).toBe('terminal:codex');
    expect(resolveHomeAgent(options, 'terminal:claude')?.key).toBe('session:opencode');
  });

  test('none ready: the first listed', () => {
    const cold = homeAgentOptions(
      discovery([{ id: 'deepseek', kind: 'deepseek', name: 'DeepSeek', status: 'offline' }]),
      []
    );
    expect(resolveHomeAgent(cold, undefined)?.key).toBe('session:deepseek');
    expect(resolveHomeAgent([], undefined)).toBeNull();
  });
});

describe('parseHomeAgentChoices', () => {
  test('keeps well-formed keys only', () => {
    expect(
      parseHomeAgentChoices('{"a":"session:opencode","b":"terminal:codex","c":"bogus","d":3}')
    ).toEqual({ a: 'session:opencode', b: 'terminal:codex' });
    expect(parseHomeAgentChoices('not json')).toEqual({});
    expect(parseHomeAgentChoices(undefined)).toEqual({});
  });
});

describe('a stored terminal agent before the catalog is read', () => {
  const sessionsOnly = homeAgentOptions(fleet, undefined);

  test('is shown by name, unconfirmed, never replaced by another agent', () => {
    const agent = resolveHomeAgent(sessionsOnly, 'terminal:codex', false);
    expect(agent).toMatchObject({ key: 'terminal:codex', kind: 'terminal', name: 'Codex' });
    expect(agent?.kind === 'terminal' && agent.confirmed).toBe(false);
  });

  test('once the catalog is read and lacks it, the first ready agent takes over', () => {
    expect(resolveHomeAgent(sessionsOnly, 'terminal:codex', true)?.key).toBe('session:opencode');
  });
});
