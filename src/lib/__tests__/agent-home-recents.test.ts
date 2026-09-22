import { describe, expect, test } from 'bun:test';

import {
  isRootSessionRecent,
  removeChildSessionRecents,
  rootSessionWithStatus,
} from '../agent-home-recents';
import type { AgentSessionInfo } from '../agent-protocol';
import { createHomeRecentsStore } from '../home-recents-state';
import { createHomeRecentEntry, serializeHomeRecents, type HomeTarget } from '../home-recents';

const target = (asid: string, serverId = 'server-a', directory = '/workspace'): HomeTarget => ({
  kind: 'opencode-session',
  serverId,
  sessionId: 'gateway-session',
  directory,
  asid,
});

describe('authoritative subagent Home exclusion', () => {
  test('only root visits qualify; status, titles and pane rows are not hierarchy', () => {
    expect(isRootSessionRecent({})).toBe(true);
    expect(isRootSessionRecent({ parent_id: 'root' })).toBe(false);
    expect(isRootSessionRecent({ deleted: true })).toBe(false);
  });

  test('status-only events update known roots but never children or unknown sessions', () => {
    const session = (asid: string, parent_id?: string): AgentSessionInfo => ({
      asid,
      backend_session_id: asid,
      title: asid,
      model: null,
      status: 'idle',
      directory: '/workspace',
      ...(parent_id ? { parent_id } : {}),
      updated_ms: 1,
    });
    const inventory = [session('root'), session('child', 'root')];

    expect(rootSessionWithStatus(inventory, 'root', 'busy')).toMatchObject({
      asid: 'root',
      status: 'busy',
    });
    expect(rootSessionWithStatus(inventory, 'child', 'busy')).toBeNull();
    expect(rootSessionWithStatus(inventory, 'unknown', 'busy')).toBeNull();
  });

  test('child inventory removes matching persisted visits after hydration, across old directories only on that server', async () => {
    const entries = [
      createHomeRecentEntry(target('child'), 'child', 5),
      createHomeRecentEntry(target('child', 'server-a', '/old'), 'child', 4),
      createHomeRecentEntry(target('child', 'server-b'), 'other server', 3),
      createHomeRecentEntry(target('root'), 'root', 2),
    ].filter((entry) => entry !== null);
    let saved = '';
    const store = createHomeRecentsStore({
      load: async () => serializeHomeRecents(entries),
      save: async (serialized) => {
        saved = serialized;
      },
    });
    await removeChildSessionRecents(store.getState, 'server-a', [
      { asid: 'root' },
      { asid: 'child', parent_id: 'root' },
    ]);
    expect(store.getState().entries.map((entry) => entry.title)).toEqual(['other server', 'root']);
    expect(saved).not.toContain('/old');
    await store.getState().visit(target('root'), 'normal root visit', 10);
    expect(store.getState().entries[0]?.title).toBe('normal root visit');
  });
});
