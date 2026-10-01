import { describe, expect, test } from 'bun:test';

import { agentSessionListQuery } from '../agent-session-list-query';
import { workbenchAgentId } from '../agent-session-tree';

describe('agentSessionListQuery', () => {
  test('a multi-agent gateway names the default agent too', () => {
    const agentId = workbenchAgentId({ discovered: true, initialAgentId: 'opencode' });
    expect(agentSessionListQuery({ roots: true, limit: 50, agentId })).toBe(
      '?roots=true&limit=50&agent_id=opencode'
    );
  });

  test('a multi-agent gateway names any other agent', () => {
    expect(agentSessionListQuery({ roots: true, agentId: 'deepseek' })).toBe(
      '?roots=true&agent_id=deepseek'
    );
  });

  test('a legacy gateway without multi_agent sends no agent_id', () => {
    const agentId = workbenchAgentId({
      discovered: false,
      initialAgentId: 'opencode',
      selectedAgentId: 'opencode',
    });
    expect(agentSessionListQuery({ roots: true, limit: 50, agentId })).toBe('?roots=true&limit=50');
  });

  test('no query is no query string', () => {
    expect(agentSessionListQuery(undefined)).toBe('');
  });
});
