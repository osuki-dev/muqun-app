import { expect, test } from 'bun:test';
import { agentProfilesFromResponse } from '../agent-spawn';
import { createWorkApi, type WorkDetail, type WorkTask, type WorkTransport } from '../work-api';
import { WorkController, workCapabilities, type WorkCapabilities } from '../work-controller';

const taskId = '11111111-1111-4111-8111-111111111111';
test('managed selection requires an explicit installation probe without changing legacy catalog behavior', () => {
  const catalog = {
    agents: [
      { kind: 'unknown' },
      { kind: 'missing', available: false },
      { kind: 'codex', available: true },
    ],
  };
  expect(
    agentProfilesFromResponse(catalog, { requireAvailable: true })
      .filter((profile) => profile.available)
      .map((profile) => profile.kind)
  ).toEqual(['codex']);
  expect(agentProfilesFromResponse(catalog)[0].available).toBe(true);
});
const leadId = '22222222-2222-4222-8222-222222222222';
const workerId = '33333333-3333-4333-8333-333333333333';
const resultId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';
const task: WorkTask = {
  id: taskId,
  session_id: 'session-a',
  repo_path: '/repo',
  title: 'A task',
  brief: 'A goal',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 2 },
  revision: 1,
  created_at_ms: 1,
  updated_at_ms: 1,
  paused: false,
};
const binding = {
  instance_id: 'native-lead',
  target: 'opaque',
  pane_id: 'p1',
  worktree_path: '/repo',
};
const initial: WorkDetail = {
  task,
  attempts: [
    {
      ...binding,
      id: leadId,
      task_id: taskId,
      agent_kind: 'codex',
      role: 'lead',
      created_at_ms: 1,
    },
    {
      ...binding,
      instance_id: 'native-worker',
      pane_id: 'p2',
      id: workerId,
      task_id: taskId,
      agent_kind: 'codex',
      role: 'worker',
      created_at_ms: 2,
    },
  ],
  operations: [],
  results: [
    {
      id: resultId,
      task_id: taskId,
      attempt_id: leadId,
      summary: 'Original result',
      evidence: [],
      artifacts: [],
      created_at_ms: 3,
    },
  ],
  reviews: [],
  cursor: 1,
};
function fixture(
  readProfiles = async () => [{ kind: 'codex', command: 'codex', available: true }],
  recordsResponse?: () => unknown,
  resultResponse?: () => unknown
) {
  let capabilities: WorkCapabilities = { connected: true, records: true, execution: true };
  let detail = initial;
  let pending: (() => Promise<void>) | null = null;
  let fail = false;
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  const transport: WorkTransport = async (_record, path, request) => {
    if (request.method === 'GET') {
      if (path.includes('/results/')) return { status: 200, body: resultResponse?.() };
      if (path.includes('/records?')) return { status: 200, body: recordsResponse?.() };
      if (path.includes('/changes?'))
        return {
          status: 200,
          body: {
            changes: [
              {
                cursor: 2,
                task_id: taskId,
                revision: 2,
                kind: 'result_submitted',
                entity_id: resultId,
              },
            ],
            cursor: 2,
            reset_required: false,
          },
        };
      if (path.includes('/tasks?'))
        return { status: 200, body: { tasks: [detail.task], next_after_id: null } };
      return { status: 200, body: detail };
    }
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    mutations.push({ path, body });
    if (pending) await pending();
    if (fail) throw new Error('lost acknowledgement');
    if (path.endsWith('/delegation'))
      return {
        status: 200,
        body: { value: { ...task, paused: body.paused, revision: 2 }, replayed: false },
      };
    if (path.endsWith('/reviews'))
      return {
        status: 200,
        body: {
          value: {
            id: operationId,
            task_id: taskId,
            actor_id: 'paired-user',
            submission_id: body.submission_id,
            decision: body.decision,
            message: body.message,
            created_at_ms: 4,
          },
          replayed: false,
        },
      };
    return {
      status: 200,
      body: {
        value: {
          id: operationId,
          task_id: taskId,
          attempt_id: leadId,
          kind: path.endsWith('/attempts') ? 'start_attempt' : 'deliver_prompt',
          state: 'acknowledged',
          resources: binding,
          failure_code: null,
          created_at_ms: 4,
          updated_at_ms: 4,
        },
        replayed: false,
      },
    };
  };
  let keys = 0;
  const controller = new WorkController(
    createWorkApi(
      { serverId: 'a', label: 'A', url: 'https://a.invalid', token: 'token', pairedAt: 1 },
      'session-a',
      transport
    ),
    async () => capabilities,
    () => `key-${++keys}`,
    readProfiles
  );
  controller.activate();
  return {
    controller,
    mutations,
    setCapabilities: (next: WorkCapabilities) => {
      capabilities = next;
    },
    setDetail: (next: WorkDetail) => {
      detail = next;
    },
    delay: (next: () => Promise<void>) => {
      pending = next;
    },
    fail: () => {
      fail = true;
    },
  };
}
async function opened() {
  const value = fixture();
  await value.controller.refresh();
  await value.controller.selectTask(taskId);
  return value;
}

test('attachment preparation waits before POST and rechecks capability without clearing files', async () => {
  const value = await opened();
  value.controller.addressAttempt(leadId);
  value.controller.setDraft('Read the attachment');
  value.setCapabilities({ connected: true, records: true, execution: true, inputs: true });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleared = 0;
  const sending = value.controller.deliver(async () => {
    await waiting;
    return {
      inputRefs: [{ input_id: resultId, caption: 'Reference', use: 'reference-only' }],
      isCurrent: () => true,
      onAcknowledged: () => {
        cleared++;
      },
    };
  });
  await Promise.resolve();
  expect(value.mutations).toHaveLength(0);
  value.setCapabilities({ connected: true, records: true, execution: true });
  release();
  await sending;
  expect(value.mutations).toHaveLength(0);
  expect(cleared).toBe(0);
  expect(value.controller.getSnapshot().draft).toBe('Read the attachment');
});

test('review follow-up addresses the lead and exact immutable receipt without sending or replacing a newer draft', async () => {
  const { controller, mutations } = await opened();
  controller.selectResult(resultId);
  controller.selectAttempt(workerId);
  const review = await controller.review(
    resultId,
    1,
    'changes_requested',
    'Please fix the edge case.'
  );
  expect(review?.submission_id).toBe(resultId);
  expect(mutations).toHaveLength(1);
  expect(controller.prepareReviewFollowup(operationId)).toBe(true);
  expect(controller.getSnapshot().recipientId).toBe(leadId);
  expect(controller.getSnapshot().selectedAttemptId).toBe(workerId);
  expect(controller.getSnapshot().selectedResultId).toBe(resultId);
  expect(controller.getSnapshot().draft.includes(resultId)).toBe(true);
  expect(controller.getSnapshot().draft.includes(operationId)).toBe(true);
  expect(mutations).toHaveLength(1);
  controller.setDraft('A newer instruction');
  expect(controller.prepareReviewFollowup(operationId)).toBe(false);
  expect(controller.getSnapshot().draft).toBe('A newer instruction');
});

test('managed capabilities require this pairing, this session and both versioned contracts', () => {
  const health = {
    serverId: 'a',
    capabilities: ['work_execution_v1'],
    backends: [
      { sessionId: 'session-a', connected: true, capabilities: ['work_tasks_v1'] },
      { sessionId: 'other', connected: true, capabilities: ['work_tasks_v1', 'work_execution_v1'] },
    ],
  };
  expect(workCapabilities(health, 'a', 'session-a')).toEqual({
    connected: true,
    records: true,
    execution: false,
  });
  expect(workCapabilities(health, 'b', 'session-a').records).toBe(false);
  expect(workCapabilities(health, 'a', 'missing').execution).toBe(false);
});
test('browsing a worker does not retarget the lead composer', async () => {
  const { controller } = await opened();
  controller.selectAttempt(workerId);
  expect(controller.getSnapshot().selectedAttemptId).toBe(workerId);
  expect(controller.getSnapshot().recipientId).toBe(leadId);
  controller.addressAttempt(workerId);
  expect(controller.getSnapshot().recipientId).toBe(workerId);
});
test('changes only raise a notice; refresh preserves the selected result version', async () => {
  const { controller, setDetail } = await opened();
  const newer = {
    ...initial,
    results: [
      ...initial.results,
      { ...initial.results[0], id: operationId, summary: 'New result' },
    ],
    task: { ...task, revision: 2 },
    cursor: 2,
  };
  setDetail(newer);
  const pinned = controller.getSnapshot().detail;
  await controller.checkUpdates();
  expect(controller.getSnapshot().detail).toBe(pinned);
  expect(controller.getSnapshot().hasUpdates).toBe(true);
  await controller.refresh();
  expect(controller.getSnapshot().selectedResultId).toBe(resultId);
  expect(controller.getSnapshot().detail?.results.length).toBe(2);
});
test('fresh capability loss refuses a tracked send without any input fallback', async () => {
  const { controller, mutations, setCapabilities } = await opened();
  controller.setDraft('Do the work');
  setCapabilities({ connected: true, records: true, execution: false });
  await controller.deliver();
  expect(mutations).toHaveLength(0);
  expect(controller.getSnapshot().draft).toBe('Do the work');
  expect(controller.getSnapshot().error).toBe('execution_unavailable');
});
test('double tap is single-flight and newer draft text survives the first receipt', async () => {
  const { controller, mutations, delay } = await opened();
  let release: () => void = () => undefined;
  delay(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  controller.setDraft('First message');
  const first = controller.deliver();
  await Promise.resolve();
  await Promise.resolve();
  await controller.deliver();
  controller.setDraft('A newer draft');
  release();
  await first;
  expect(mutations).toHaveLength(1);
  expect(mutations[0].path).toContain(`/attempts/${leadId}/deliveries`);
  expect(mutations[0].body.request_key).toBe('key-1');
  expect(controller.getSnapshot().draft).toBe('A newer draft');
});
test('unconfirmed mutation survives close/reopen and refresh without replay', async () => {
  const { controller, mutations, fail } = await opened();
  fail();
  controller.setDraft('Only once');
  await controller.deliver();
  const pending = controller.getSnapshot().pending;
  expect(pending?.state).toBe('unconfirmed');
  controller.deactivate();
  controller.activate();
  await controller.refresh();
  await controller.deliver();
  expect(mutations).toHaveLength(1);
  expect(controller.getSnapshot().pending).toEqual(pending);
});
test('result acceptance rejects an unseen version and sends the exact displayed submission', async () => {
  const { controller, mutations } = await opened();
  await controller.review(operationId, 1, 'accepted');
  expect(mutations).toHaveLength(0);
  await controller.review(resultId, 1, 'accepted');
  expect(mutations).toHaveLength(1);
  expect(mutations[0].body).toMatchObject({
    submission_id: resultId,
    expected_revision: 1,
    decision: 'accepted',
  });
});
test('record-only capability permits delegation pause but no agent launch', async () => {
  const { controller, mutations, setCapabilities } = await opened();
  setCapabilities({ connected: true, records: true, execution: false });
  await controller.start('codex');
  expect(mutations).toHaveLength(0);
  await controller.setPaused(true);
  expect(mutations).toHaveLength(1);
  expect(controller.getSnapshot().detail?.task.paused).toBe(true);
});

test('native disconnection does not disable durable record review or pause', () => {
  expect(
    workCapabilities(
      {
        serverId: 'a',
        backends: [
          {
            sessionId: 'session-a',
            connected: false,
            capabilities: ['work_tasks_v1', 'work_execution_v1'],
          },
        ],
      },
      'a',
      'session-a'
    )
  ).toEqual({ connected: true, records: true, execution: false });
});

function goalFixture(
  uncertain: 'start' | 'deliver' | 'created_read' | null = null,
  references: NonNullable<WorkTask['input_refs']> = []
) {
  const savedTask = references.length ? { ...task, input_refs: references } : task;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let started = false;
  const op = {
    id: operationId,
    task_id: taskId,
    attempt_id: leadId,
    kind: 'start_attempt',
    state: 'acknowledged',
    resources: binding,
    failure_code: null,
    created_at_ms: 3,
    updated_at_ms: 3,
  };
  const transport: WorkTransport = async (_record, path, request) => {
    if (request.method === 'GET' && uncertain === 'created_read')
      throw new Error('Read failed after durable creation');
    if (request.method === 'GET')
      return {
        status: 200,
        body: started
          ? { ...initial, task: { ...task, revision: 4 }, results: [], operations: [op] }
          : { ...initial, attempts: [], results: [], operations: [] },
      };
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    calls.push({ path, body });
    if (path.endsWith('/tasks'))
      return { status: 200, body: { value: savedTask, replayed: false } };
    if (path.endsWith('/attempts')) {
      started = true;
      return {
        status: 200,
        body: {
          value: { ...op, state: uncertain === 'start' ? 'unconfirmed' : 'acknowledged' },
          replayed: false,
        },
      };
    }
    if (uncertain === 'deliver') throw new Error('lost delivery response');
    return {
      status: 200,
      body: {
        value: {
          ...op,
          id: '66666666-6666-4666-8666-666666666666',
          kind: 'deliver_prompt',
          input_refs: references,
        },
        replayed: false,
      },
    };
  };
  let key = 0;
  const controller = new WorkController(
    createWorkApi(
      { serverId: 'a', label: 'A', url: 'https://a.invalid', token: 'a', pairedAt: 1 },
      'session-a',
      transport
    ),
    async () => ({ connected: true, records: true, execution: true, inputs: true }),
    () => `key-${++key}`,
    async () => [{ kind: 'codex', command: 'codex', available: true }]
  );
  controller.activate();
  return { controller, calls };
}

test('initial prompt explicitly references claimed task files while startup has no inherited inputs', async () => {
  const ref = { input_id: resultId, caption: 'Layout reference', use: 'reference-only' as const };
  const frozen = {
    ...ref,
    name: 'reference.png',
    mime: 'image/png',
    size_bytes: 12,
    sha256: 'a'.repeat(64),
  };
  const { controller, calls } = goalFixture(null, [frozen]);
  let cleared = 0;
  expect(
    await controller.startGoal(task, async () => ({
      inputRefs: [ref],
      isCurrent: () => true,
      onAcknowledged: () => {
        cleared++;
      },
    }))
  ).toBe(true);
  expect(calls.map((call) => call.body.input_refs)).toEqual([[ref], undefined, [ref]]);
  expect(cleared).toBe(1);
});

test('uncertain follow-up keeps captured attachments and the original draft', async () => {
  const value = await opened();
  value.setCapabilities({ connected: true, records: true, execution: true, inputs: true });
  value.controller.addressAttempt(leadId);
  value.controller.setDraft('Read this reference');
  value.fail();
  let cleared = 0;
  await value.controller.deliver(async () => ({
    inputRefs: [{ input_id: resultId, caption: '', use: 'reference-only' }],
    isCurrent: () => true,
    onAcknowledged: () => {
      cleared++;
    },
  }));
  expect(value.mutations).toHaveLength(1);
  expect(value.controller.getSnapshot().pending?.state).toBe('unconfirmed');
  expect(value.controller.getSnapshot().draft).toBe('Read this reference');
  expect(cleared).toBe(0);
});

test('one Start task action preserves separate create/start/delivery receipts and fresh revision', async () => {
  const { controller, calls } = goalFixture();
  expect(await controller.startGoal(task)).toBe(true);
  expect(calls).toHaveLength(3);
  expect(calls.map((call) => call.body.request_key)).toEqual(['key-1', 'key-2', 'key-3']);
  expect(calls[1].body.prompt).toBeUndefined();
  expect(calls[2].body).toMatchObject({
    text: task.brief,
    expected_revision: 4,
    expected_instance_id: 'native-lead',
  });
  expect(controller.getSnapshot().draft).toBe('');
  expect(controller.getSnapshot().requiresRefresh).toBe(true);
  expect(controller.getSnapshot().detail?.operations.map((operation) => operation.kind)).toEqual([
    'start_attempt',
    'deliver_prompt',
  ]);
});

test('acknowledged creation survives a failed detail read and the same intent never creates twice', async () => {
  const { controller, calls } = goalFixture('created_read');
  expect(await controller.startGoal(task)).toBe(false);
  expect(controller.getSnapshot().pending).toMatchObject({
    taskId,
    kind: 'create',
    state: 'acknowledged',
  });
  controller.deactivate();
  controller.activate();
  expect(await controller.startGoal(task)).toBe(false);
  expect(calls).toHaveLength(1);
  expect(controller.getSnapshot().tasks[0].id).toBe(taskId);
});

test('uncertain startup stops before initial prompt and retains known task, resources and key', async () => {
  const { controller, calls } = goalFixture('start');
  expect(await controller.startGoal(task)).toBe(false);
  expect(calls).toHaveLength(2);
  expect(controller.getSnapshot().pending).toMatchObject({
    taskId,
    kind: 'start',
    requestKey: 'key-2',
    operationId,
  });
  expect(controller.getSnapshot().tasks[0].id).toBe(taskId);
  expect(controller.getSnapshot().draft).toBe(task.brief);
});

test('catalog disappearance refuses creation and retains the selected lead and goal', async () => {
  let installed = true;
  const { controller, mutations } = fixture(async () =>
    installed ? [{ kind: 'codex', command: 'codex', available: true }] : []
  );
  await controller.refreshProfiles();
  controller.updateCreationDraft({ goal: 'Keep this draft' });
  expect(controller.getSnapshot().creationDraft.agents).toBe('codex');
  installed = false;
  expect(await controller.startGoal(task)).toBe(false);
  expect(mutations).toHaveLength(0);
  expect(controller.getSnapshot().error).toBe('catalog_unavailable');
  expect(controller.getSnapshot().creationDraft.goal).toBe('Keep this draft');
  expect(controller.getSnapshot().creationDraft.agents).toBe('codex');
});

test('a catalog response from a closed scope cannot populate the picker', async () => {
  let resolve!: (value: { kind: string; command: string; available: boolean }[]) => void;
  const { controller } = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const reading = controller.refreshProfiles();
  controller.deactivate();
  resolve([{ kind: 'codex', command: 'codex', available: true }]);
  await reading;
  expect(controller.getSnapshot().profiles).toHaveLength(0);
  expect(controller.getSnapshot().creationDraft.agents).toBe('');
});

test('execution waits for complete history and explicit pagination preserves the selected result', async () => {
  const page = { snapshot_revision: 1, after_id: null, next_after_id: null, has_more: false };
  const { controller, mutations, setDetail } = fixture(undefined, () => ({
    items: [initial.attempts[1]],
    page: { ...page, after_id: leadId },
  }));
  setDetail({
    ...initial,
    attempts: [initial.attempts[0]],
    pages: {
      attempts: { ...page, next_after_id: leadId, has_more: true },
      operations: page,
      results: page,
      reviews: page,
    },
  });
  await controller.refresh();
  await controller.selectTask(taskId);
  controller.setDraft('Only after all operation history is known');
  await controller.deliver();
  expect(mutations).toHaveLength(0);
  const resultSnapshot = controller.getSnapshot().detail!.results;
  await controller.loadRecords('attempt');
  expect(controller.getSnapshot().detail?.attempts).toHaveLength(2);
  expect(controller.getSnapshot().detail?.results).toBe(resultSnapshot);
  expect(controller.getSnapshot().selectedResultId).toBe(resultId);
  await controller.deliver();
  expect(mutations).toHaveLength(1);
});

test('a changed pagination revision cannot append to the pinned task', async () => {
  const page = { snapshot_revision: 1, after_id: null, next_after_id: null, has_more: false };
  const { controller, setDetail } = fixture(undefined, () => ({
    items: [initial.attempts[1]],
    page: { ...page, snapshot_revision: 2, after_id: leadId },
  }));
  setDetail({
    ...initial,
    attempts: [initial.attempts[0]],
    pages: {
      attempts: { ...page, next_after_id: leadId, has_more: true },
      operations: page,
      results: page,
      reviews: page,
    },
  });
  await controller.refresh();
  await controller.selectTask(taskId);
  const pinned = controller.getSnapshot().detail;
  await controller.loadRecords('attempt');
  expect(controller.getSnapshot().detail).toBe(pinned);
  expect(controller.getSnapshot().requiresRefresh).toBe(true);
});

test('explicit refresh retrieves the selected immutable result when it moves beyond the first page', async () => {
  const { controller, setDetail } = fixture(undefined, undefined, () => initial.results[0]);
  await controller.refresh();
  await controller.selectTask(taskId);
  const otherId = '00000000-0000-4000-8000-000000000000';
  const page = { snapshot_revision: 2, after_id: null, next_after_id: null, has_more: false };
  setDetail({
    ...initial,
    task: { ...task, revision: 2 },
    results: [{ ...initial.results[0], id: otherId, summary: 'Another version' }],
    pages: {
      attempts: page,
      operations: page,
      reviews: page,
      results: { ...page, has_more: true, next_after_id: otherId },
    },
  });
  await controller.refresh();
  expect(controller.getSnapshot().selectedResultId).toBe(resultId);
  expect(
    controller.getSnapshot().detail?.results.find((result) => result.id === resultId)?.summary
  ).toBe('Original result');
});

test('lost initial prompt ACK retains the delivery key without replaying the successful startup', async () => {
  const { controller, calls } = goalFixture('deliver');
  expect(await controller.startGoal(task)).toBe(false);
  expect(controller.getSnapshot().pending).toMatchObject({
    taskId,
    kind: 'deliver',
    requestKey: 'key-3',
    state: 'unconfirmed',
  });
  await controller.startGoal(task);
  expect(calls).toHaveLength(3);
  expect(controller.getSnapshot().draft).toBe(task.brief);
});

test('Back and offline return preserve historical selection, output, recipient and draft without refresh', async () => {
  const { controller, mutations, setDetail } = await opened();
  controller.selectAttempt(workerId);
  controller.selectResult(resultId);
  controller.addressAttempt(leadId);
  controller.setDraft('Unsent follow-up');
  const detail = controller.getSnapshot().detail!;
  const snapshot = { text: 'Pinned old output', signature: 'pinned', hasNewOutput: true };
  controller.viewMemory.rememberOutput(taskId, workerId, 'native-worker', snapshot);
  controller.saveViewAnchor('detail', { itemId: resultId, relativeOffset: 20, rawOffset: 600 });
  controller.showList();
  expect(controller.getSnapshot().view).toBe('list');
  expect(controller.getSnapshot().detail).toBe(detail);
  setDetail({ ...initial, task: { ...task, title: 'Must not automatically fetch this' } });
  controller.markUnavailable();
  await controller.selectTask(taskId);
  expect(controller.getSnapshot()).toMatchObject({
    view: 'detail',
    selectedAttemptId: workerId,
    selectedResultId: resultId,
    recipientId: leadId,
    draft: 'Unsent follow-up',
  });
  expect(controller.getSnapshot().detail).toBe(detail);
  expect(controller.viewMemory.output(taskId, workerId, 'native-worker')).toBe(snapshot);
  expect(controller.getViewAnchor('detail')?.itemId).toBe(resultId);
  expect(mutations).toHaveLength(0);
});

test('switching tasks preserves separate drafts and remembered historical selection', async () => {
  const { controller, setDetail, mutations } = await opened();
  controller.selectAttempt(workerId);
  controller.setDraft('Draft A');
  const otherId = '77777777-7777-4777-8777-777777777777';
  const other = JSON.parse(JSON.stringify(initial).replaceAll(taskId, otherId)) as WorkDetail;
  setDetail(other);
  await controller.selectTask(otherId);
  controller.setDraft('Draft B');
  await controller.selectTask(taskId);
  expect(controller.getSnapshot().detail?.task.id).toBe(taskId);
  expect(controller.getSnapshot().selectedAttemptId).toBe(workerId);
  expect(controller.getSnapshot().draft).toBe('Draft A');
  await controller.selectTask(otherId);
  expect(controller.getSnapshot().draft).toBe('Draft B');
  expect(mutations).toHaveLength(0);
});

test('Tasks after uncertain creation/start shows list and retains recovery rather than reopening creation', async () => {
  const { controller, calls } = goalFixture('start');
  controller.showCreate();
  expect(await controller.startGoal(task)).toBe(false);
  const before = controller.getSnapshot();
  controller.showList();
  expect(controller.getSnapshot().view).toBe('list');
  expect(controller.getSnapshot().detail).toBe(before.detail);
  expect(controller.getSnapshot().draft).toBe(task.brief);
  expect(controller.getSnapshot().pending).toBe(before.pending);
  await controller.selectTask(taskId);
  expect(controller.getSnapshot().view).toBe('detail');
  expect(calls).toHaveLength(2);
});
