import { describe, expect, test } from 'bun:test';

import { createResponseGate, notificationOpening } from '../notification-route';

const paired = (serverId: string) => serverId === 'server-1';

describe('notificationOpening', () => {
  // The payloads the gateway sends, as the gateway's own tests pin them.
  const cases: {
    name: string;
    data: Record<string, unknown>;
    isPad?: boolean;
    isPaired?: (serverId: string) => boolean;
    expected: unknown;
  }[] = [
    {
      name: 'a finished native turn opens its agent session on a phone',
      data: { type: 'agent.completed', server_id: 'server-1', agent_id: 'codex', asid: 'a1' },
      expected: {
        kind: 'open',
        route: { pathname: '/agent', params: { server: 'server-1', asid: 'a1', agentId: 'codex' } },
      },
    },
    {
      name: 'the same push on a Pad opens the workspace with the agent named',
      data: { type: 'agent.completed', server_id: 'server-1', agent_id: 'pi', asid: 'a1' },
      isPad: true,
      expected: {
        kind: 'open',
        route: {
          pathname: '/servers/[serverId]',
          params: { serverId: 'server-1', asid: 'a1', agentId: 'pi' },
        },
      },
    },
    {
      name: 'a native approval opens the session that holds the pending card',
      data: {
        type: 'approval',
        category: 'approval',
        server_id: 'server-1',
        agent_id: 'claude',
        asid: 'a2',
        approval_id: 'per_1',
        fingerprint: 'per_1',
      },
      expected: {
        kind: 'open',
        route: {
          pathname: '/agent',
          params: { server: 'server-1', asid: 'a2', agentId: 'claude' },
        },
      },
    },
    {
      name: 'a pane approval keeps opening its terminal pane',
      data: {
        type: 'approval.pending',
        categoryId: 'approval',
        server_id: 'server-1',
        session_id: 'default',
        pane_id: 'p1',
      },
      expected: {
        kind: 'open',
        route: {
          pathname: '/servers/[serverId]',
          params: {
            serverId: 'server-1',
            sessionId: 'default',
            paneId: 'p1',
            notificationId: 'n1',
          },
        },
      },
    },
    {
      name: 'a push from a computer no longer paired opens nothing of it',
      data: { type: 'agent.completed', server_id: 'server-9', agent_id: 'codex', asid: 'a1' },
      expected: { kind: 'unpaired', serverId: 'server-9' },
    },
    {
      name: 'an unreadable pairing list trusts the push',
      data: { type: 'agent.completed', server_id: 'server-9', agent_id: 'codex', asid: 'a1' },
      isPaired: undefined,
      expected: {
        kind: 'open',
        route: { pathname: '/agent', params: { server: 'server-9', asid: 'a1', agentId: 'codex' } },
      },
    },
  ];

  for (const { name, data, isPad, expected, ...rest } of cases) {
    test(name, () => {
      const isPaired = 'isPaired' in rest ? rest.isPaired : paired;
      expect(notificationOpening(data, 'n1', { isPad, isPaired })).toEqual(expected as never);
    });
  }
});

test('one tap opens one screen, and another action on it is a new response', () => {
  const fresh = createResponseGate(2);
  expect(fresh('n1\u0000default')).toBe(true);
  expect(fresh('n1\u0000default')).toBe(false);
  expect(fresh('n1\u0000approval.allow')).toBe(true);
});
