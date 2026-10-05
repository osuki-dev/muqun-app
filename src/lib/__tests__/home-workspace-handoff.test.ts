import { describe, expect, test } from 'bun:test';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import { padRouteHandoff } from '@/lib/pad-detail';

describe('homeWorkspaceHandoffStore agent payload', () => {
  test('an agent route survives publish and consume', () => {
    const { target, agent } = padRouteHandoff({ serverId: 's1', asid: 'a1' });
    const id = homeWorkspaceHandoffStore.getState().publish(target, undefined, 's0', agent);
    const consumed = homeWorkspaceHandoffStore.getState().consume(id ?? -1);
    expect(consumed?.agent).toEqual({
      target: { kind: 'agent-session', serverId: 's1', asid: 'a1' },
      intent: 'existing',
    });
    expect(consumed?.sourceServerId).toBe('s0');
    expect(homeWorkspaceHandoffStore.getState().handoff).toBeNull();
  });
  test('a terminal handoff carries no agent', () => {
    const { target, agent } = padRouteHandoff({ serverId: 's1', paneId: 'p1' });
    const id = homeWorkspaceHandoffStore.getState().publish(target, undefined, undefined, agent);
    expect(homeWorkspaceHandoffStore.getState().consume(id ?? -1)?.agent).toBeUndefined();
  });
});
