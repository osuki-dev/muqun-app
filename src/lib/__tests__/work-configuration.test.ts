import { expect, test } from 'bun:test';
import {
  createWorkApi,
  parseWorkTask,
  parseWorkDependencies,
  type WorkTask,
  type WorkDetail,
  type WorkDependency,
} from '../work-api';
import { WorkController } from '../work-controller';
import { createWorkJournal } from '../work-journal';
import { parseWorkDelegationState, type WorkDelegationIntent } from '../work-delegation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = {
  serverId: 'gateway',
  label: 'Gateway',
  url: 'https://example.invalid',
  token: 'paired',
  pairedAt: 1,
};
const task: WorkTask = {
  id: id(1),
  session_id: 'session',
  repo_path: '/repo',
  title: 'Root',
  brief: 'Goal',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 1 },
  revision: 4,
  created_at_ms: 1,
  updated_at_ms: 1,
  paused: false,
  delegation: parseWorkDelegationState(undefined),
  dependencies: [],
};
const initial: WorkDetail = {
  task,
  attempts: [
    {
      id: id(2),
      task_id: task.id,
      agent_kind: 'codex',
      role: 'lead',
      instance_id: 'launch',
      target: 'target',
      pane_id: 'pane',
      worktree_path: '/repo',
      created_at_ms: 1,
      lifecycle: {
        launch_phase: 'launch_confirmed',
        reservation: 'reserved',
        native_owner_epoch: 'epoch',
        release: null,
      },
    },
  ],
  operations: [],
  results: [
    {
      id: id(3),
      task_id: task.id,
      attempt_id: id(2),
      summary: 'Pinned',
      artifacts: [],
      evidence: [],
      created_at_ms: 1,
    },
  ],
  reviews: [],
  cursor: 4,
};
const intent: WorkDelegationIntent = {
  serverId: 'gateway',
  sessionId: 'session',
  taskId: task.id,
  expected_revision: 4,
  coordinator: {
    taskId: task.id,
    attemptId: id(2),
    instanceId: 'launch',
    nativeOwnerEpoch: 'epoch',
  },
  input: {
    policy: {
      enabled: true,
      max_children: 4,
      max_depth: 1,
      dependency_requirement: 'human_accepted',
    },
    coordinator_attempt_id: id(2),
  },
};
function fixture(child = false) {
  let detail: WorkDetail = child
    ? { ...initial, task: { ...task, parent_task_id: id(9) } }
    : initial;
  const sibling: WorkTask = { ...task, id: id(8), parent_task_id: id(9) };
  let lost = false,
    capable = true,
    changed = false;
  let saved: WorkTask | null = null;
  let raw: string | null = null;
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const journal = createWorkJournal(
    {
      read: async () => raw,
      write: async (value) => {
        raw = value;
      },
    },
    { pairingFingerprint: 'a'.repeat(64), sessionId: 'session' }
  );
  const api = createWorkApi(record, 'session', async (_record, path, request) => {
    const body = JSON.parse(request.body ?? '{}');
    calls.push({ path, method: request.method, body });
    if (request.method === 'POST') {
      saved = path.endsWith('/delegation-config')
        ? {
            ...detail.task,
            revision: 5,
            delegation: { ...(body.input as typeof intent.input), coordinator_epoch: 1 },
          }
        : { ...detail.task, revision: 5, dependencies: body.dependencies as WorkDependency[] };
      if (lost) throw new Error('Lost committed reply');
      return { status: 200, body: { value: saved, replayed: false } };
    }
    if (path.includes('/receipts?'))
      return {
        status: 200,
        body: {
          kind: path.includes('configure_delegation') ? 'configure_delegation' : 'set_dependencies',
          value: saved,
        },
      };
    if (path.includes('/tasks?'))
      return { status: 200, body: { tasks: [detail.task, sibling], next_after_id: null } };
    if (path.endsWith(`/tasks/${sibling.id}`))
      return { status: 200, body: { ...initial, task: sibling, attempts: [], results: [] } };
    if (path.includes('/results/'))
      return { status: 200, body: { ...initial.results[0], id: id(7), task_id: sibling.id } };
    return {
      status: 200,
      body: changed
        ? { ...detail, attempts: [{ ...detail.attempts[0], instance_id: 'replacement' }] }
        : { ...detail, task: saved ?? detail.task },
    };
  });
  let keys = 0;
  const make = () =>
    new WorkController(
      api,
      async () => ({ connected: true, records: true, execution: true, delegation: capable }),
      () => `key-${++keys}`,
      undefined,
      journal
    );
  const controller = make();
  const open = async () => {
    controller.activate();
    await controller.refresh();
    await controller.selectTask(task.id);
    controller.setDraft('Keep this draft');
  };
  return {
    controller,
    open,
    calls,
    journal,
    make,
    setLost: () => {
      lost = true;
    },
    setCapable: (value: boolean) => {
      capable = value;
    },
    changeLead: () => {
      changed = true;
    },
    truncateHistory: () => {
      detail = {
        ...detail,
        pages: {
          attempts: { snapshot_revision: 4, after_id: null, next_after_id: id(2), has_more: true },
          operations: {
            snapshot_revision: 4,
            after_id: null,
            next_after_id: null,
            has_more: false,
          },
          results: { snapshot_revision: 4, after_id: null, next_after_id: null, has_more: false },
          reviews: { snapshot_revision: 4, after_id: null, next_after_id: null, has_more: false },
        },
      };
    },
  };
}
test('legacy task records normalize disabled delegation and dependencies reject foreign shapes or duplicate prerequisites', () => {
  expect(
    parseWorkTask({ ...task, delegation: undefined, dependencies: undefined }, 'session').delegation
      ?.policy.enabled
  ).toBe(false);
  expect(() =>
    parseWorkDependencies([
      { prerequisite_task_id: id(8), submission_id: null },
      { prerequisite_task_id: id(8), submission_id: id(7) },
    ])
  ).toThrow();
  expect(() => parseWorkTask({ ...task, dependencies: null }, 'session')).toThrow();
  expect(() =>
    parseWorkTask({ ...task, delegation: { ...task.delegation, coordinator_epoch: -1 } }, 'session')
  ).toThrow();
});

test('disabling delegation is allowed with incomplete history and never needs a newly selected lead', async () => {
  const value = fixture();
  value.truncateHistory();
  await value.open();
  await value.controller.configureDelegation({
    ...intent,
    coordinator: null,
    input: {
      ...intent.input,
      policy: { ...intent.input.policy, enabled: false },
      coordinator_attempt_id: null,
    },
  });
  expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(value.controller.getSnapshot().detail?.task.delegation?.policy.enabled).toBe(false);
});

test('configuration and dependency acknowledgements reject substituted saved policy or exact submission', async () => {
  let response: WorkTask = {
    ...task,
    revision: 5,
    delegation: { ...intent.input, coordinator_epoch: 9 },
  };
  const api = createWorkApi(record, 'session', async () => ({
    status: 200,
    body: { value: response, replayed: false },
  }));
  const configError = await api
    .configureDelegation(task.id, intent.input, 4, 0, 'config-key', { isCurrent: () => true })
    .catch((error: unknown) => error);
  expect((configError as { outcome: string }).outcome).toBe('unconfirmed');
  response = {
    ...task,
    revision: 5,
    dependencies: [{ prerequisite_task_id: id(8), submission_id: id(6) }],
  };
  const dependencyError = await api
    .setDependencies(
      task.id,
      [{ prerequisite_task_id: id(8), submission_id: id(7) }],
      4,
      'dependency-key',
      { isCurrent: () => true }
    )
    .catch((error: unknown) => error);
  expect((dependencyError as { outcome: string }).outcome).toBe('unconfirmed');
});

test('lost dependency update retains its own receipt key across reconstruction without another POST', async () => {
  const value = fixture(true);
  await value.open();
  value.setLost();
  await value.controller.setDependencies({
    serverId: 'gateway',
    sessionId: 'session',
    taskId: task.id,
    expected_revision: 4,
    dependencies: [{ prerequisite_task_id: id(8), submission_id: null }],
  });
  expect((await value.journal.load())?.kind).toBe('dependencies');
  const restored = value.make();
  restored.activate();
  const boundary = value.calls.length;
  await restored.refresh();
  expect(value.calls.slice(boundary).every((call) => call.method === 'GET')).toBe(true);
  expect(restored.getSnapshot().detail?.task.dependencies).toEqual([
    { prerequisite_task_id: id(8), submission_id: null },
  ]);
  expect(restored.getSnapshot().pending).toBe(null);
});
test('configuration is one revision-fenced record mutation preserving draft and pinned results, without launch or delivery', async () => {
  const value = fixture();
  await value.open();
  const before = value.controller.getSnapshot();
  await value.controller.configureDelegation(intent);
  const posts = value.calls.filter((call) => call.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toEqual({
    request_key: 'key-1',
    expected_revision: 4,
    input: intent.input,
  });
  const after = value.controller.getSnapshot();
  expect(after.detail?.task.delegation?.coordinator_epoch).toBe(1);
  expect(after.detail?.results).toBe(before.detail?.results);
  expect(after.selectedResultId).toBe(before.selectedResultId);
  expect(after.draft).toBe('Keep this draft');
  expect(after.pending).toBe(null);
});
test('changed lead, foreign captured scope, and lost capability dispatch no configuration', async () => {
  for (const mode of ['lead', 'scope', 'capability']) {
    const value = fixture();
    await value.open();
    if (mode === 'lead') value.changeLead();
    if (mode === 'capability') value.setCapable(false);
    await value.controller.configureDelegation(
      mode === 'scope' ? { ...intent, serverId: 'other' } : intent
    );
    expect(value.calls.some((call) => call.method === 'POST')).toBe(false);
  }
});
test('unknown configuration restores exact request key and GET-only recovery without replay', async () => {
  const value = fixture();
  await value.open();
  value.setLost();
  await value.controller.configureDelegation(intent);
  expect(value.controller.getSnapshot().pending?.kind).toBe('configure');
  const restored = value.make();
  restored.activate();
  const boundary = value.calls.length;
  await restored.refresh();
  expect(value.calls.slice(boundary).every((call) => call.method === 'GET')).toBe(true);
  expect(restored.getSnapshot().pending).toBe(null);
  expect(restored.getSnapshot().detail?.task.delegation?.policy.enabled).toBe(true);
});
test('dependency updates preserve exact selected submission and null does not silently choose a result', async () => {
  for (const submission_id of [null, id(7)]) {
    const value = fixture(true);
    await value.open();
    await value.controller.setDependencies({
      serverId: 'gateway',
      sessionId: 'session',
      taskId: task.id,
      expected_revision: 4,
      dependencies: [{ prerequisite_task_id: id(8), submission_id }],
    });
    const posts = value.calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.dependencies).toEqual([{ prerequisite_task_id: id(8), submission_id }]);
    expect(value.calls.some((call) => call.path.includes('/results/'))).toBe(
      submission_id !== null
    );
    expect(value.controller.getSnapshot().draft).toBe('Keep this draft');
  }
});
