import { describe, expect, test } from 'bun:test';

import { homeServerModel, type HomeServerModelInput } from '@/lib/home-server-model';
import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import { SERVER_AGENTS_STALE_AFTER_MS } from '@/lib/server-agents';

const NOW = 1_700_000_000_000;

function agent(id: string, overrides: Partial<ServerAgent> = {}): ServerAgent {
  return {
    id,
    name: id,
    status: 'idle',
    hasAgent: true,
    ...overrides,
  };
}

function snapshot(
  serverId: string,
  agents: ServerAgent[],
  checkedAtMs = NOW
): ServerAgentsSnapshot {
  return { serverId, checkedAtMs, agents };
}

function model(overrides: Partial<HomeServerModelInput> = {}) {
  return homeServerModel({
    serverId: 'server-1',
    snapshot: snapshot('server-1', []),
    reachability: 'unknown',
    paneMode: 'all',
    nowMs: NOW,
    ...overrides,
  });
}

describe('homeServerModel', () => {
  test('rejects a snapshot for another server', () => {
    const result = model({ snapshot: snapshot('server-2', [agent('wrong')]) });

    expect(result.snapshot).toBeUndefined();
    expect(result.snapshotState).toBe('unseen');
    expect(result.rows).toEqual([]);
  });

  test('distinguishes missing snapshots from an observed empty snapshot', () => {
    expect(model({ snapshot: undefined })).toMatchObject({
      snapshotState: 'unseen',
      stale: false,
      age: undefined,
      rows: [],
    });
    expect(model()).toMatchObject({ snapshotState: 'current-empty', rows: [] });
  });

  test('keeps freshness separate from reachability', () => {
    const staleSnapshot = snapshot(
      'server-1',
      [agent('a')],
      NOW - SERVER_AGENTS_STALE_AFTER_MS - 1
    );
    expect(model({ snapshot: staleSnapshot, reachability: 'live' })).toMatchObject({
      snapshotState: 'stale-agents',
      stale: true,
      agentStatusesCurrent: false,
    });
    expect(
      model({
        snapshot: snapshot('server-1', [agent('a', { status: 'blocked' })]),
        reachability: 'offline',
      })
    ).toMatchObject({
      snapshotState: 'current-agents',
      stale: false,
      agentStatusesCurrent: false,
    });
  });

  test('filters and deduplicates in source order while retaining source objects', () => {
    const first = agent('agent-1', { paneId: 'pane-1' });
    const duplicate = { ...first, id: 'pane-1' };
    const plain = agent('pane-2', { hasAgent: false, paneId: 'pane-2', cwd: '/tmp' });
    const result = model({ snapshot: snapshot('server-1', [first, duplicate, plain]) });

    expect(result.rows.map((row) => row.agent)).toEqual([first, plain]);
    expect(result.rows[0]?.agent).toBe(first);
    expect(
      model({ snapshot: snapshot('server-1', [first, plain]), paneMode: 'agents' }).rows
    ).toHaveLength(1);
  });

  test('keys rows by server and pane or row identity without string collisions', () => {
    const pane = agent('same', { paneId: 'id' });
    const row = agent('id');
    const result = model({ snapshot: snapshot('server-1', [pane, row]) });
    const otherServer = model({
      serverId: 'server-2',
      snapshot: snapshot('server-2', [agent('same', { paneId: 'id' })]),
    });

    expect(result.rows.map((item) => item.key)).toEqual([
      JSON.stringify(['server-1', 'pane', 'id']),
      JSON.stringify(['server-1', 'row', 'id']),
    ]);
    expect(otherServer.rows[0]?.key).not.toBe(result.rows[0]?.key);

    const emptyPaneId = model({
      snapshot: snapshot('server-1', [agent('empty-pane-id', { paneId: '' })]),
    });
    expect(emptyPaneId.rows[0]?.key).toBe(JSON.stringify(['server-1', 'row', 'empty-pane-id']));
  });

  test('shows recent blocked status, but does not fabricate status for plain panes', () => {
    const blocked = agent('blocked', { status: 'blocked' });
    const plain = agent('shell', { hasAgent: false, status: 'blocked', cwd: '/work' });
    const result = model({ snapshot: snapshot('server-1', [blocked, plain]) });

    expect(result.rows[0]?.caption).toEqual({ kind: 'status', status: 'blocked' });
    expect(result.rows[0]?.spokenCaption).toEqual({ kind: 'status', status: 'blocked' });
    expect(result.rows[1]?.caption).toEqual({ kind: 'location', text: '/work' });
    expect(result.rows[1]?.spokenCaption).toEqual({ kind: 'location', text: '/work' });
  });

  test('stale or offline rows lose status captions but retain location captions', () => {
    const blocked = agent('blocked', { status: 'blocked', cwd: '/work' });
    const stale = model({
      snapshot: snapshot('server-1', [blocked], NOW - SERVER_AGENTS_STALE_AFTER_MS - 1),
      reachability: 'live',
    });
    const offline = model({
      snapshot: snapshot('server-1', [blocked]),
      reachability: 'offline',
    });

    expect(stale.rows[0]).toMatchObject({
      caption: { kind: 'location', text: '/work' },
      spokenCaption: { kind: 'location', text: '/work' },
    });
    expect(offline.rows[0]).toMatchObject({
      caption: { kind: 'location', text: '/work' },
      spokenCaption: { kind: 'location', text: '/work' },
    });
  });
});
