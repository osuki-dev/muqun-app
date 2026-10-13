import { expect, test } from 'bun:test';
import { taskAttentionDestination } from '../task-attention';
import { createHomeAttentionStore } from '../home-attention';
import { SERVER_AGENTS_STALE_AFTER_MS, type ServerAgentsSnapshot } from '../server-agents';
import type { TaskView } from '../task-ledger';

const nowMs = 1_700_000_000_000;
const task: TaskView = {
  taskId: 'assignment',
  state: 'waiting',
  kind: 'delegation',
  goal: 'Validate the app',
  summary: 'The QA device is unavailable.',
  updatedMs: nowMs,
  binding: { kind: 'pane', agentId: 'codex', sessionId: 'session', paneId: 'pane', shellPid: 42 },
};
const panes: ServerAgentsSnapshot = {
  serverId: 'computer',
  sessionId: 'session',
  checkedAtMs: nowMs,
  agents: [
    {
      id: 'agent',
      name: 'Codex',
      status: 'working',
      hasAgent: true,
      paneId: 'pane',
      shellPid: 42,
      instanceId: 'instance',
    },
  ],
};
const input = { task, serverId: 'computer', panes, requests: {}, nowMs };

test('a blocked report with a working agent opens the reason without rewriting waiting history', () => {
  const before = structuredClone(task);
  expect(taskAttentionDestination(input)).toBe('waiting-detail');
  expect(task).toEqual(before);
  expect(taskAttentionDestination({ ...input, panes: undefined })).toBe('waiting-detail');
});

test('a concrete asynchronous question still opens its terminal while the agent works', () => {
  const pending = {
    ...panes,
    agents: panes.agents.map((agent) => ({ ...agent, pendingUserInput: true })),
  };
  expect(taskAttentionDestination({ ...input, panes: pending })).toBe('work');
  expect(
    taskAttentionDestination({
      ...input,
      panes: pending,
      nowMs: nowMs + SERVER_AGENTS_STALE_AFTER_MS + 1,
    })
  ).toBe('waiting-detail');
  expect(taskAttentionDestination({ ...input, panes: { ...pending, serverId: 'other' } })).toBe(
    'waiting-detail'
  );
  expect(
    taskAttentionDestination({
      ...input,
      task: {
        ...task,
        binding: {
          ...task.binding,
          kind: 'pane',
          sessionId: 'session',
          paneId: 'pane',
          agentId: 'codex',
          shellPid: 43,
        },
      },
      panes: pending,
    })
  ).toBe('waiting-detail');
});

test('a session request takes precedence until its exact request resolves', () => {
  const store = createHomeAttentionStore();
  const target = {
    kind: 'agent-session' as const,
    serverId: 'computer',
    asid: 'conversation',
    sessionId: 'session',
    directory: '/work',
  };
  const sessionTask: TaskView = {
    ...task,
    binding: { kind: 'agent_session', agentId: 'agent', asid: 'conversation' },
  };
  const destination = () =>
    taskAttentionDestination({ ...input, task: sessionTask, requests: store.getState().byTarget });
  store.getState().pending({ ...target, serverId: 'other' }, 'request', nowMs);
  expect(destination()).toBe('waiting-detail');
  store.getState().pending(target, 'request', nowMs);
  expect(destination()).toBe('work');
  store.getState().resolve(target, 'request', nowMs + 1);
  expect(destination()).toBe('waiting-detail');
});

test('ordinary rows keep opening their live work or result', () => {
  for (const state of [
    'working',
    'queued',
    'idle_unconfirmed',
    'done',
    'failed',
    'cancelled',
  ] as const) {
    expect(taskAttentionDestination({ ...input, task: { ...task, state } })).toBe('work');
  }
  expect(taskAttentionDestination({ ...input, task: { ...task, summary: undefined } })).toBe(
    'waiting-detail'
  );
});
