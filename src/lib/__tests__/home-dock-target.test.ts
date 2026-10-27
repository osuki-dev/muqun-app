import { describe, expect, test } from 'bun:test';

import { homeDockTargetId, homeTargetRow, resolveHomeComposerTarget } from '@/lib/home-composer';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { deckOrder } from '@/lib/home-computer-deck';
import { homeThreadSendPlan, parseHomeThreads } from '@/lib/home-thread';

describe('Home target restoration', () => {
  const serverIds = ['a', 'b'];

  test('a restart restores the front computer as the send target without switching the connection', () => {
    const rememberedId = 'b';
    const front = deckOrder(null, serverIds, rememberedId)[0];
    expect(homeDockTargetId({ serverIds, rememberedId, selectedId: 'a' })).toBe(front);
  });

  test('an explicit target pick wins over the remembered card and a later connection change', () => {
    expect(homeDockTargetId({ serverIds, pickedId: 'a', rememberedId: 'b', selectedId: 'b' })).toBe(
      'a'
    );
  });

  test('removed targets cannot be restored or used for sending', () => {
    expect(
      homeDockTargetId({ serverIds, pickedId: 'removed', rememberedId: 'b', selectedId: 'a' })
    ).toBe('b');
    expect(homeDockTargetId({ serverIds, rememberedId: 'removed', selectedId: 'a' })).toBe('a');
    expect(homeDockTargetId({ serverIds, rememberedId: 'removed' })).toBe('a');
    expect(homeDockTargetId({ serverIds: ['a'], rememberedId: 'removed' })).toBe('a');
    expect(homeDockTargetId({ serverIds: [], rememberedId: 'b' })).toBeUndefined();
  });

  test('initial and deleted-target fallbacks agree with the visible computer before a temporary connection changes', () => {
    const initial = homeDockTargetId({ serverIds, selectedId: 'b' });
    expect(initial).toBe('b');
    // The controller remembers this fallback before opening any session elsewhere.
    expect(homeDockTargetId({ serverIds, rememberedId: initial, selectedId: 'a' })).toBe('b');
    const fallback = homeDockTargetId({
      serverIds: ['a', 'c'],
      rememberedId: initial,
      selectedId: 'gone',
    });
    expect(fallback).toBe('a');
    expect(
      homeDockTargetId({ serverIds: ['a', 'c'], rememberedId: fallback, selectedId: 'c' })
    ).toBe('a');
    expect(homeDockTargetId({ serverIds: [], rememberedId: fallback })).toBeUndefined();
  });
});

describe('the computer picker', () => {
  test('a confirmed-offline computer is listed dimmed and refused, with its last sighting', () => {
    expect(
      homeTargetRow({
        serverId: 'air',
        reachability: 'offline',
        lastSeenMs: 5,
        currentServerId: 'osk',
      })
    ).toEqual({ offline: true, selectable: false, current: false, lastSeenMs: 5 });
  });

  test('reconnecting or unchecked stays selectable; online rows are unchanged', () => {
    for (const reachability of ['unknown', undefined, 'live'] as const)
      expect(homeTargetRow({ serverId: 'osk', reachability, lastSeenMs: 5 })).toEqual({
        offline: false,
        selectable: true,
        current: false,
      });
  });

  test('the current computer is marked current even offline; the composer keeps it', () => {
    expect(
      homeTargetRow({ serverId: 'hk', reachability: 'offline', currentServerId: 'hk' })
    ).toMatchObject({ current: true, selectable: false });
    const servers = [{ serverId: 'hk' }, { serverId: 'osk' }] as GatewayRecord[];
    expect(
      resolveHomeComposerTarget({
        servers,
        chosen: servers[0],
        reachabilityByServer: { hk: 'offline', osk: 'live' },
      })
    ).toEqual({ kind: 'offline', server: servers[0]! });
  });
});

test('restoring and switching Home computers keeps each reply bound to its saved conversation', () => {
  const threads = parseHomeThreads(
    JSON.stringify({
      a: {
        kind: 'session',
        serverId: 'a',
        sessionId: 'terminal-a',
        asid: 'session-a',
        title: 'A',
        setAtMs: 1,
      },
      b: {
        kind: 'session',
        serverId: 'b',
        sessionId: 'terminal-b',
        asid: 'session-b',
        title: 'B',
        setAtMs: 2,
      },
    })
  );
  const saved = JSON.stringify(threads);
  const serverIds = ['a', 'b'];
  const rememberedId = 'b';
  const targetId = homeDockTargetId({ serverIds, rememberedId, selectedId: 'a' });
  expect(targetId).toBe('b');
  expect(
    homeThreadSendPlan({ target: threads[targetId!], features: { inbox: false, steering: false } })
  ).toEqual({ kind: 'session', sessionId: 'terminal-b', asid: 'session-b' });
  const next = homeDockTargetId({ serverIds, pickedId: 'a', rememberedId, selectedId: 'b' });
  expect(
    homeThreadSendPlan({ target: threads[next!], features: { inbox: false, steering: false } })
  ).toEqual({ kind: 'session', sessionId: 'terminal-a', asid: 'session-a' });
  expect(JSON.stringify(threads)).toBe(saved);
  const fallback = homeDockTargetId({ serverIds: ['a'], rememberedId });
  expect(fallback).toBe('a');
  expect(threads[fallback!]?.serverId).toBe('a');
});
