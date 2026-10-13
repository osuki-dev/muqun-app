import { expect, test } from 'bun:test';
import { taskAttentionView, taskHasPendingInput } from '../task-attention';
import { createHomeAttentionStore } from '../home-attention';
import { SERVER_AGENTS_STALE_AFTER_MS, type ServerAgentsSnapshot } from '../server-agents';
import type { TaskView } from '../task-ledger';
import {
  buildComputerCards,
  buildTaskTree,
  groupTaskTree,
  openTaskWork,
  taskRowVisual,
} from '../home-computer-cards';
import { homeWaitingTasks } from '../home-in-progress';

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
      pendingUserInput: false,
      paneId: 'pane',
      shellPid: 42,
      instanceId: 'instance',
    },
  ],
};
const input = { task, serverId: 'computer', panes, requests: {}, nowMs };

test('a blocked report with a freshly working agent does not rewrite waiting history', () => {
  const before = structuredClone(task);
  expect(taskAttentionView(input)).toMatchObject({ state: 'working', summary: undefined });
  expect(task).toEqual(before);
  expect(taskAttentionView({ ...input, panes: undefined })).toMatchObject({
    state: 'idle_unconfirmed',
    summary: undefined,
  });
});

test('a concrete asynchronous question still opens its terminal while the agent works', () => {
  const pending = {
    ...panes,
    agents: panes.agents.map((agent) => ({ ...agent, pendingUserInput: true })),
  };
  expect(taskAttentionView({ ...input, panes: pending })).toMatchObject({
    state: 'waiting',
    summary: undefined,
  });
  expect(
    taskAttentionView({
      ...input,
      panes: pending,
      nowMs: nowMs + SERVER_AGENTS_STALE_AFTER_MS + 1,
    })
  ).toMatchObject({ state: 'idle_unconfirmed', summary: undefined });
  expect(taskAttentionView({ ...input, panes: { ...pending, serverId: 'other' } })).toMatchObject({
    state: 'idle_unconfirmed',
    summary: undefined,
  });
  expect(
    taskAttentionView({
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
  ).toMatchObject({ state: 'idle_unconfirmed', summary: undefined });
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
    taskAttentionView({ ...input, task: sessionTask, requests: store.getState().byTarget });
  store.getState().pending({ ...target, serverId: 'other' }, 'request', nowMs);
  expect(destination()).toMatchObject({ state: 'idle_unconfirmed', summary: undefined });
  store.getState().pending(target, 'request', nowMs);
  expect(destination()).toMatchObject({ state: 'waiting', summary: undefined });
  store.getState().resolve(target, 'request', nowMs + 1);
  expect(destination()).toMatchObject({ state: 'idle_unconfirmed', summary: undefined });
});

test('ordinary rows retain their ledger state', () => {
  for (const state of [
    'working',
    'queued',
    'idle_unconfirmed',
    'done',
    'failed',
    'cancelled',
  ] as const) {
    expect(taskAttentionView({ ...input, task: { ...task, state } }).state).toBe(state);
  }
  expect(taskAttentionView({ ...input, task: { ...task, summary: undefined } }).state).toBe(
    'working'
  );
});

test('native question lifecycle agrees across the card, attention list and row without changing history', () => {
  const workingTask = { ...task, state: 'working' as const };
  for (const ledgerTask of [task, workingTask]) {
    const index = { computer: { tasks: [ledgerTask], fetchedAt: nowMs } };
    for (const pendingUserInput of [false, true, false]) {
      const snapshot = {
        ...panes,
        agents: panes.agents.map((agent) => ({ ...agent, pendingUserInput })),
      };
      const panesByServer = { computer: snapshot };
      const [card] = buildComputerCards({
        servers: [{ serverId: 'computer' }],
        index,
        reachability: () => 'live',
        dismissed: new Set(),
        nowMs,
        panesByServer,
      });
      expect(card?.activity).toBe(pendingUserInput ? 'needs-you' : 'working');
      expect(card?.now[0]?.task).toBe(ledgerTask);
      expect(homeWaitingTasks(index, ['computer'], [], { panesByServer, nowMs })).toHaveLength(
        pendingUserInput ? 1 : 0
      );
      const view = taskAttentionView({ ...input, task: ledgerTask, panes: snapshot });
      const groups = groupTaskTree(buildTaskTree([ledgerTask]), (task) =>
        taskHasPendingInput({ ...input, task, panes: snapshot })
      );
      expect(groups.attention).toHaveLength(pendingUserInput ? 1 : 0);
      expect(
        taskRowVisual(view, { canComplete: false, acknowledged: false }).needsYou === true
      ).toBe(pendingUserInput);
      expect(view.summary).toBe(
        pendingUserInput || ledgerTask.state === 'waiting' ? undefined : ledgerTask.summary
      );
    }
    expect(ledgerTask.summary).toBe('The QA device is unavailable.');
  }
});

test('stale, status-only, replaced and unknown agents leave a quiet unresolved task', () => {
  const observations = [
    undefined,
    { ...panes, agents: panes.agents.map((agent) => ({ ...agent, pendingUserInput: undefined })) },
    { ...panes, checkedAtMs: nowMs - SERVER_AGENTS_STALE_AFTER_MS - 1 },
    { ...panes, agents: panes.agents.map((agent) => ({ ...agent, instanceId: undefined })) },
    { ...panes, agents: panes.agents.map((agent) => ({ ...agent, shellPid: 43 })) },
    { ...panes, agents: panes.agents.map((agent) => ({ ...agent, status: 'unknown' as const })) },
  ];
  for (const observed of observations) {
    expect(taskAttentionView({ ...input, panes: observed })).toMatchObject({
      state: 'idle_unconfirmed',
      summary: undefined,
    });
  }
  expect(task.state).toBe('waiting');
});

test('a recorded blocker opens its terminal directly', async () => {
  const opened: unknown[][] = [];
  await openTaskWork(
    { openServer: (...args) => opened.push(args), openAgent: () => {}, openTaskResult: () => {} },
    'computer',
    task
  );
  expect(opened).toEqual([['computer', 'pane', 'session']]);
});
