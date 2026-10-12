import { expect, test } from 'bun:test';
import { terminalPendingUserInput } from '../terminal-input-attention';
import {
  normalizeServerAgents,
  parseServerAgentsIndex,
  sameServerAgents,
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgentsSnapshot,
} from '../server-agents';

const NOW = 1_700_000_000_000;
const snapshot: ServerAgentsSnapshot = {
  serverId: 'computer',
  sessionId: 'qa',
  checkedAtMs: NOW,
  agents: [
    {
      id: 'agent',
      paneId: 'pane',
      instanceId: 'instance',
      shellPid: 4242,
      name: 'Codex',
      hasAgent: true,
      status: 'working',
      pendingUserInput: true,
    },
  ],
};

test('pending ordinary-question attention is independent of current input and work status', () => {
  expect(terminalPendingUserInput(snapshot, 'qa', 'pane', NOW, 4242)).toBe(true);
  for (const status of ['idle', 'blocked', 'unknown'] as const) {
    const changed = { ...snapshot, agents: snapshot.agents.map((agent) => ({ ...agent, status })) };
    expect(terminalPendingUserInput(changed, 'qa', 'pane', NOW, 4242)).toBe(true);
  }
});

test('missing, stale, mismatched and unbound observations cannot add attention', () => {
  expect(terminalPendingUserInput(undefined, 'qa', 'pane', NOW, 4242)).toBe(false);
  expect(terminalPendingUserInput(snapshot, 'other', 'pane', NOW, 4242)).toBe(false);
  expect(terminalPendingUserInput(snapshot, 'qa', 'other', NOW, 4242)).toBe(false);
  expect(
    terminalPendingUserInput(snapshot, 'qa', 'pane', NOW + SERVER_AGENTS_STALE_AFTER_MS + 1, 4242)
  ).toBe(false);
  const unbound = {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({ ...agent, instanceId: undefined })),
  };
  expect(terminalPendingUserInput(unbound, 'qa', 'pane', NOW, 4242)).toBe(false);
});

test('a historical task requires the same observed shell incarnation', () => {
  expect(terminalPendingUserInput(snapshot, 'qa', 'pane', NOW, undefined)).toBe(false);
  expect(terminalPendingUserInput(snapshot, 'qa', 'pane', NOW, 4243)).toBe(false);
  const replaced = {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({ ...agent, shellPid: undefined })),
  };
  expect(terminalPendingUserInput(replaced, 'qa', 'pane', NOW, 4242)).toBe(false);
});

test('native attention survives storage and its resolution invalidates the mirrored row', () => {
  const normalized = normalizeServerAgents(snapshot);
  const restored = parseServerAgentsIndex(JSON.stringify({ computer: normalized }));
  expect(restored.computer?.agents[0]).toMatchObject({
    instanceId: 'instance',
    shellPid: 4242,
    pendingUserInput: true,
  });
  const resolved = {
    ...normalized,
    agents: normalized.agents.map((agent) => ({ ...agent, pendingUserInput: undefined })),
  };
  expect(sameServerAgents(normalized, resolved)).toBe(false);
});
