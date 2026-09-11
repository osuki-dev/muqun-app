import { beforeEach, expect, test } from 'bun:test';

import {
  forgetWarmWorkspace,
  rememberWarmWorkspace,
  WARM_WORKSPACE_TTL_MS,
  warmWorkspace,
  warmWorkspaceCount,
  type WarmWorkspace,
} from '@/lib/server-warm-cache';

const snapshot = (sessionId = 'default'): WarmWorkspace => ({
  // Only its presence is read; `hasLoadedData` is `Boolean(data.health)`.
  health: { ok: true } as unknown as WarmWorkspace['health'],
  sessionId,
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
});

beforeEach(() => forgetWarmWorkspace());

test('a server reads back the snapshot it wrote', () => {
  rememberWarmWorkspace('s1', snapshot('work'), 1_000);
  expect(warmWorkspace('s1', 1_000)?.sessionId).toBe('work');
});

test('a server with nothing written reads back nothing', () => {
  expect(warmWorkspace('s1', 1_000)).toBeNull();
});

test('a snapshot past its window is dropped rather than painted', () => {
  rememberWarmWorkspace('s1', snapshot(), 1_000);
  expect(warmWorkspace('s1', 1_000 + WARM_WORKSPACE_TTL_MS)).not.toBeNull();
  expect(warmWorkspace('s1', 1_000 + WARM_WORKSPACE_TTL_MS + 1)).toBeNull();
  // Dropped, not merely hidden: a stale entry must not hold memory either.
  expect(warmWorkspaceCount()).toBe(0);
});

test('a clock that moves backwards drops the entry instead of trusting it', () => {
  rememberWarmWorkspace('s1', snapshot(), 10_000);
  expect(warmWorkspace('s1', 9_000)).toBeNull();
});

test('a reply with no health is not a snapshot worth painting', () => {
  rememberWarmWorkspace('s1', { ...snapshot(), health: null }, 1_000);
  expect(warmWorkspace('s1', 1_000)).toBeNull();
  expect(warmWorkspaceCount()).toBe(0);
});

test('an empty server id is never stored', () => {
  rememberWarmWorkspace('', snapshot(), 1_000);
  expect(warmWorkspaceCount()).toBe(0);
});

test('only the last few servers are held, oldest written first to go', () => {
  for (const id of ['a', 'b', 'c', 'd', 'e']) rememberWarmWorkspace(id, snapshot(id), 1_000);
  expect(warmWorkspaceCount()).toBe(4);
  expect(warmWorkspace('a', 1_000)).toBeNull();
  expect(warmWorkspace('e', 1_000)?.sessionId).toBe('e');
});

test('re-writing a server keeps it from being evicted as the oldest', () => {
  for (const id of ['a', 'b', 'c', 'd']) rememberWarmWorkspace(id, snapshot(id), 1_000);
  rememberWarmWorkspace('a', snapshot('a2'), 2_000);
  rememberWarmWorkspace('e', snapshot('e'), 2_000);
  expect(warmWorkspace('a', 2_000)?.sessionId).toBe('a2');
  expect(warmWorkspace('b', 2_000)).toBeNull();
});

test('forgetting one server leaves the others alone', () => {
  rememberWarmWorkspace('s1', snapshot(), 1_000);
  rememberWarmWorkspace('s2', snapshot(), 1_000);
  forgetWarmWorkspace('s1');
  expect(warmWorkspace('s1', 1_000)).toBeNull();
  expect(warmWorkspace('s2', 1_000)).not.toBeNull();
});

test('forgetting everything clears the cache', () => {
  rememberWarmWorkspace('s1', snapshot(), 1_000);
  rememberWarmWorkspace('s2', snapshot(), 1_000);
  forgetWarmWorkspace();
  expect(warmWorkspaceCount()).toBe(0);
});
