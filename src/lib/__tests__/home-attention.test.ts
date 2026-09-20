import { describe, expect, test } from 'bun:test';

import { createHomeAttentionStore } from '@/lib/home-attention';
import { homeTargetKey, type HomeTarget } from '@/lib/home-recents';

const target: Extract<HomeTarget, { kind: 'opencode-session' }> = {
  kind: 'opencode-session',
  serverId: 'a',
  sessionId: 'herdr',
  directory: '/work',
  asid: 'session',
};

describe('Home attention observations', () => {
  test('the same request id on another server cannot be resolved accidentally', () => {
    const store = createHomeAttentionStore();
    const other = { ...target, serverId: 'b' };
    const targetSnapshot = store.getState().reserve();
    store.getState().observe(target, ['request'], 10, targetSnapshot);
    store.getState().observe(other, ['request'], 10);
    store.getState().resolve(target, 'request');
    store.getState().observe(target, ['request'], 9, targetSnapshot);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual([]);
    expect(store.getState().byTarget[homeTargetKey(other)].requestIds).toEqual(['request']);
  });

  test('an authoritative empty result wins over an older pending result', () => {
    const store = createHomeAttentionStore();
    const oldSnapshot = store.getState().reserve();
    const currentSnapshot = store.getState().reserve();
    store.getState().observe(target, [], 20, currentSnapshot);
    store.getState().observe(target, ['old'], 10, oldSnapshot);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual([]);
  });

  test('a late snapshot cannot resurrect a resolved event', () => {
    const store = createHomeAttentionStore();
    // The snapshot started first. The event resolved while it was in flight,
    // then the response arrived with its earlier ticket.
    const snapshotTicket = store.getState().reserve();
    store.getState().resolve(target, 'request', 20);
    store.getState().observe(target, ['request'], 30, snapshotTicket);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual([]);
  });

  test('a resolve before the first snapshot leaves a scoped tombstone', () => {
    const store = createHomeAttentionStore();
    const snapshotTicket = store.getState().reserve();
    store.getState().resolve(target, 'request', 20);
    store.getState().observe(target, ['request', 'new'], 30, snapshotTicket);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual([]);
  });

  test('a stale snapshot cannot replace a newer pending event', () => {
    const store = createHomeAttentionStore();
    const snapshotTicket = store.getState().reserve();
    store.getState().pending(target, 'new', 20);
    store.getState().observe(target, [], 30, snapshotTicket);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual(['new']);
  });

  test('target summaries are bounded and ordered by local publication tickets', () => {
    const store = createHomeAttentionStore();
    const lateOldTarget = { ...target, serverId: 'old' };
    const lateTicket = store.getState().reserve();
    for (let index = 0; index < 25; index += 1) {
      store
        .getState()
        .observe({ ...target, serverId: `server-${index}` }, [`request-${index}`], 100 - index);
    }
    // The old response is rejected by the eviction watermark even though its
    // timestamp would otherwise sort ahead of newer observations.
    store.getState().observe(lateOldTarget, ['late'], 1, lateTicket);
    const keys = Object.keys(store.getState().byTarget);
    expect(keys).toHaveLength(24);
    expect(store.getState().byTarget[keys[0]].target.serverId).toBe('server-24');
    expect(store.getState().byTarget[keys.at(-1)!].target.serverId).toBe('server-1');
    expect(store.getState().byTarget[homeTargetKey(lateOldTarget)]).toBeUndefined();
  });

  test('unpair cleanup retains other servers and stores only a bounded request summary', () => {
    const store = createHomeAttentionStore();
    store.getState().observe(target, ['same', 'same', ''], 10);
    store.getState().observe({ ...target, serverId: 'b' }, ['other'], 10);
    const staleSnapshot = store.getState().reserve();
    store.getState().keepOnly(['a']);
    store.getState().observe({ ...target, serverId: 'b' }, ['late'], 20);
    expect(Object.keys(store.getState().byTarget)).toEqual([homeTargetKey(target)]);
    expect(store.getState().byTarget[homeTargetKey(target)].requestIds).toEqual(['same']);
    store.getState().keepOnly([]);
    store.getState().keepOnly(['a']);
    store.getState().observe(target, ['stale'], 30, staleSnapshot);
    expect(store.getState().byTarget[homeTargetKey(target)]).toBeUndefined();
  });
});
