import { describe, expect, test } from 'bun:test';
import { agentOpensInPlace, type HomeNavigation } from '@/lib/home-commands';

const agent: HomeNavigation = {
  type: 'agent',
  intent: 'existing',
  target: {
    kind: 'agent-session',
    serverId: 's1',
    sessionId: 'herdr',
    directory: '/x',
    asid: 'a1',
  } as never,
};
const server: HomeNavigation = { type: 'server', target: { serverId: 's1' } as never };

describe('agentOpensInPlace', () => {
  test('agent destination with a handler opens in place', () => {
    expect(agentOpensInPlace(agent, true)).toBe(true);
  });
  test('agent destination without a handler routes', () => {
    expect(agentOpensInPlace(agent, false)).toBe(false);
  });
  test('non-agent destinations never open in place', () => {
    expect(agentOpensInPlace(server, true)).toBe(false);
  });
});
