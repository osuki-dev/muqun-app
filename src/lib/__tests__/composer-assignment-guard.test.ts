import { describe, expect, test } from 'bun:test';
import { assignmentScopeKey, verifyAssignmentCapability } from '../composer-assignment-guard';
import type { HealthResponse } from '../gateway-client';

const health = {
  capabilities: ['agent_collaboration'],
  backends: [
    { sessionId: 'herdr', kind: 'herdr', connected: true, capabilities: ['agent_collaboration'] },
    { sessionId: 'tmux', kind: 'tmux', connected: true, capabilities: [] },
  ],
} as HealthResponse;

describe('composer assignment ownership', () => {
  test('server, session and source pane each isolate the armed selection', () => {
    const scope = { serverId: 'a', sessionId: 'herdr', sourcePaneId: '1' };
    for (const change of [{ serverId: 'b' }, { sessionId: 'tmux' }, { sourcePaneId: '2' }])
      expect(assignmentScopeKey({ ...scope, ...change })).not.toBe(assignmentScopeKey(scope));
  });

  test('a ready backend on the same server cannot authorize a tmux assignment', async () => {
    await expect(
      verifyAssignmentCapability(
        'tmux',
        async () => health,
        () => true
      )
    ).rejects.toThrow('unavailable');
    await verifyAssignmentCapability(
      'herdr',
      async () => health,
      () => true
    );
  });

  test('destination changes during capability lookup refuse delivery', async () => {
    let current = true;
    await expect(
      verifyAssignmentCapability(
        'herdr',
        async () => {
          current = false;
          return health;
        },
        () => current
      )
    ).rejects.toThrow('destination');
  });

  test('an already stale operation performs no capability request', async () => {
    let reads = 0;
    await expect(
      verifyAssignmentCapability(
        'herdr',
        async () => {
          reads += 1;
          return health;
        },
        () => false
      )
    ).rejects.toThrow('destination');
    expect(reads).toBe(0);
  });

  test('revoked selected-session capability refuses the tracked operation', async () => {
    const revoked = {
      ...health,
      backends: health.backends?.map((backend) => ({ ...backend, capabilities: [] })),
    };
    await expect(
      verifyAssignmentCapability(
        'herdr',
        async () => revoked,
        () => true
      )
    ).rejects.toThrow('unavailable');
  });
});
