import { describe, expect, test } from 'bun:test';

import type { ServerAgent, ServerAgentsSnapshot } from '@/lib/server-agents';
import { SERVER_AGENTS_STALE_AFTER_MS } from '@/lib/server-agents';
import {
  duplicatePadServerRailLabels,
  isPadServerRailAgentSelected,
  padServerRailSnapshotState,
} from '@/lib/pad-server-rail';

const NOW = 20_000_000;

function snapshot(agents: ServerAgent[], checkedAtMs = NOW): ServerAgentsSnapshot {
  return { serverId: 'server-1', checkedAtMs, agents };
}

const agent: ServerAgent = {
  id: 'agent-1',
  name: 'Review',
  status: 'working',
  hasAgent: true,
  paneId: 'pane-1',
};

describe('pad server rail snapshot state', () => {
  test('does not turn a missing snapshot into a known empty result', () => {
    expect(padServerRailSnapshotState(undefined, NOW)).toBe('unseen');
    expect(padServerRailSnapshotState(snapshot([]), NOW)).toBe('current-empty');
  });

  test('marks cached empty and populated snapshots stale after the shared freshness window', () => {
    const checkedAtMs = NOW - SERVER_AGENTS_STALE_AFTER_MS - 1;

    expect(padServerRailSnapshotState(snapshot([], checkedAtMs), NOW)).toBe('stale-empty');
    expect(padServerRailSnapshotState(snapshot([agent], checkedAtMs), NOW)).toBe('stale-agents');
    expect(padServerRailSnapshotState(snapshot([agent]), NOW)).toBe('current-agents');
  });
});

describe('pad server rail selection', () => {
  test('selects an agent only when both its server and pane match', () => {
    expect(
      isPadServerRailAgentSelected({
        agent,
        serverId: 'server-1',
        selectedServerId: 'server-1',
        selectedPaneId: 'pane-1',
      })
    ).toBe(true);
    expect(
      isPadServerRailAgentSelected({
        agent,
        serverId: 'server-2',
        selectedServerId: 'server-1',
        selectedPaneId: 'pane-1',
      })
    ).toBe(false);
  });

  test('does not guess selection for a mirrored agent without a pane id', () => {
    expect(
      isPadServerRailAgentSelected({
        agent: { ...agent, paneId: undefined },
        serverId: 'server-1',
        selectedServerId: 'server-1',
        selectedPaneId: 'pane-1',
      })
    ).toBe(false);
  });
});

test('duplicate labels are compared case-insensitively and without edge whitespace', () => {
  expect(duplicatePadServerRailLabels(['Studio', ' studio ', 'Build'])).toEqual(
    new Set(['studio'])
  );
});
