import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createDemoWorkTransport, DEMO_WORK_IDS, demoWorkArtifact } from '../demo-work';
import { createWorkApi, WorkApiError } from '../work-api';
import { WorkController } from '../work-controller';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';

const record = {
  serverId: DEMO_PAIRING_SERVER_ID,
  label: 'Demo',
  url: 'https://demo.invalid',
  token: 'demo',
  pairedAt: 0,
};
const context = { isCurrent: () => true };
const input = {
  repo_path: '/demo/homepage',
  title: 'Demo task',
  brief: 'Fictional task',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 1 },
};

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected refusal');
}

describe('offline managed work uses the real wire parser', () => {
  test('creation and startup never imply prompt delivery or result completion', async () => {
    const api = createWorkApi(record, 'demo', createDemoWorkTransport());
    const created = await api.create(input, 'create', context);
    let detail = await api.detail(created.value.id, context);
    expect(detail.attempts).toHaveLength(0);
    const started = await api.start(
      detail.task.id,
      { agent_kind: 'codex', role: 'lead' },
      detail.task.revision,
      'start',
      context
    );
    expect(started.value.kind).toBe('start_attempt');
    detail = await api.detail(detail.task.id, context);
    expect(detail.operations.map((operation) => operation.kind)).toEqual(['start_attempt']);
    expect(detail.results).toHaveLength(0);
    const attempt = detail.attempts[0];
    const sent = await api.deliver(
      detail.task.id,
      {
        attempt_id: attempt.id,
        expected_instance_id: attempt.instance_id!,
        text: 'Demo instruction',
      },
      detail.task.revision,
      'send',
      context
    );
    expect(sent.value.kind).toBe('deliver_prompt');
    expect(sent.value.attempt_id).toBe(attempt.id);
    expect((await api.detail(detail.task.id, context)).results).toHaveLength(0);
  });

  test('the production controller sequences create, start and brief delivery with separate keys', async () => {
    const transport = createDemoWorkTransport();
    const writes: { path: string; key: string }[] = [];
    const api = createWorkApi(record, 'demo', async (target, path, request) => {
      if (request.method === 'POST')
        writes.push({ path, key: JSON.parse(request.body!).request_key });
      return transport(target, path, request);
    });
    let key = 0;
    const controller = new WorkController(
      api,
      async () => ({ connected: true, records: true, execution: true }),
      () => `key-${++key}`,
      async () => [{ kind: 'codex', command: 'codex', available: true }]
    );
    controller.activate();
    expect(await controller.startGoal(input)).toBe(true);
    expect(writes).toHaveLength(3);
    expect(writes[0].path.endsWith('/tasks')).toBe(true);
    expect(writes[1].path.endsWith('/attempts')).toBe(true);
    expect(writes[2].path.endsWith('/deliveries')).toBe(true);
    expect(new Set(writes.map((write) => write.key)).size).toBe(3);
    expect(controller.getSnapshot().pending).toBe(null);
    expect(controller.getSnapshot().detail?.results).toHaveLength(0);
  });

  test('idempotency replays a receipt without starting another assistant', async () => {
    const api = createWorkApi(record, 'demo', createDemoWorkTransport());
    const task = (await api.create(input, 'create', context)).value;
    const first = await api.start(
      task.id,
      { agent_kind: 'codex', role: 'lead' },
      task.revision,
      'start',
      context
    );
    const replay = await api.start(
      task.id,
      { agent_kind: 'codex', role: 'lead' },
      task.revision,
      'start',
      context
    );
    expect(replay.replayed).toBe(true);
    expect(replay.value.id).toBe(first.value.id);
    expect((await api.detail(task.id, context)).attempts).toHaveLength(1);
  });

  test('review binds the selected immutable submission, not the latest result', async () => {
    const api = createWorkApi(record, 'demo', createDemoWorkTransport());
    const detail = await api.detail(DEMO_WORK_IDS.review, context);
    const original = JSON.stringify(detail.results);
    const receipt = await api.review(
      detail.task.id,
      { submission_id: DEMO_WORK_IDS.firstResult, decision: 'accepted', message: null },
      detail.task.revision,
      'review-first',
      context
    );
    expect(receipt.value.submission_id).toBe(DEMO_WORK_IDS.firstResult);
    const updated = await api.detail(detail.task.id, context);
    expect(JSON.stringify(updated.results)).toBe(original);
    expect(
      updated.reviews.some((review) => review.submission_id === DEMO_WORK_IDS.secondResult)
    ).toBe(false);
    const path = `/api/sessions/demo/work/tasks/${detail.task.id}/results/${DEMO_WORK_IDS.firstResult}/artifacts/0`;
    const bytes = await demoWorkArtifact(record, path, 69, context);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      detail.results[0].artifacts[0].sha256
    );
  });

  test('uncertainty remains visible across read-only status checks', async () => {
    const api = createWorkApi(record, 'demo', createDemoWorkTransport());
    const before = await api.detail(DEMO_WORK_IDS.uncertain, context);
    const operation = await api.operation(before.task.id, before.operations[0].id, context);
    expect(operation.state).toBe('unconfirmed');
    expect(await api.detail(before.task.id, context)).toEqual(before);
  });

  test('unsupported execution and changed identities refuse instead of fabricating delivery', async () => {
    const api = createWorkApi(record, 'demo', createDemoWorkTransport({ execution: false }));
    const task = (await api.create(input, 'create', context)).value;
    expect(
      await rejected(
        api.start(task.id, { agent_kind: 'codex', role: 'lead' }, task.revision, 'start', context)
      )
    ).toMatchObject({ code: 'capability_unavailable', outcome: 'refused' });
    const available = createWorkApi(record, 'demo', createDemoWorkTransport());
    const detail = await available.detail(DEMO_WORK_IDS.review, context);
    expect(
      await rejected(
        available.deliver(
          detail.task.id,
          { attempt_id: DEMO_WORK_IDS.lead, expected_instance_id: 'replaced', text: 'demo' },
          detail.task.revision,
          'send',
          context
        )
      )
    ).toMatchObject({ code: 'instance_changed' });
    expect((await available.detail(detail.task.id, context)).operations).toHaveLength(0);
  });

  test('foreign server/session requests and stale revisions are refused', async () => {
    const transport = createDemoWorkTransport();
    const foreign = createWorkApi({ ...record, serverId: 'real-server' }, 'demo', transport);
    expect((await rejected(foreign.list(context))) instanceof WorkApiError).toBe(true);
    const api = createWorkApi(record, 'demo', transport);
    expect(
      await rejected(
        api.review(
          DEMO_WORK_IDS.review,
          { submission_id: DEMO_WORK_IDS.firstResult, decision: 'accepted', message: null },
          99,
          'stale',
          context
        )
      )
    ).toMatchObject({ code: 'revision_conflict' });
  });
});

describe('fictional offline lifecycle protocol (not native delivery evidence)', () => {
  test('exact identity, conservative reservations, immutable receipt replay and explicit replacement preserve history', async () => {
    const transport = createDemoWorkTransport();
    const api = createWorkApi(record, 'demo', transport);
    const taskId = DEMO_WORK_IDS.lifecycle;
    let detail = await api.detail(taskId, context);
    const original = structuredClone(detail);
    const old = detail.attempts[0];
    const identity = {
      expected_instance_id: old.instance_id,
      expected_native_owner_epoch: old.lifecycle!.native_owner_epoch,
    };
    expect(
      await rejected(
        api.reconcile(
          taskId,
          old.id,
          {
            ...identity,
            expected_native_owner_epoch: 'other-owner-epoch',
            expected_revision: detail.task.revision,
          },
          'wrong-epoch',
          context
        )
      )
    ).toMatchObject({ code: 'instance_changed' });
    expect(
      await rejected(
        api.reconcile(
          taskId,
          old.id,
          {
            ...identity,
            expected_instance_id: 'other-launch',
            expected_revision: detail.task.revision,
          },
          'wrong-launch',
          context
        )
      )
    ).toMatchObject({ code: 'instance_changed' });
    expect(await api.detail(taskId, context)).toEqual(original);
    let first;
    for (const observation of ['live', 'unknown', 'exited'] as const) {
      const checked = await api.reconcile(
        taskId,
        old.id,
        {
          ...identity,
          expected_revision: detail.task.revision,
        },
        `check-${observation}`,
        context
      );
      first ??= checked;
      expect(checked.value.observation).toBe(observation);
      expect(checked.value.reservation).toBe(observation === 'exited' ? 'released' : 'reserved');
      detail = await api.detail(taskId, context);
      expect(detail.results).toEqual(original.results);
      expect(detail.attempts).toHaveLength(1);
      expect(detail.operations[0]).toEqual(original.operations[0]);
      if (observation !== 'exited')
        expect(
          await rejected(
            api.start(
              taskId,
              {
                agent_kind: 'claude',
                role: 'lead',
              },
              detail.task.revision,
              `blocked-${observation}`,
              context
            )
          )
        ).toMatchObject({ code: 'resource_limit' });
    }
    const replay = await api.reconcile(
      taskId,
      old.id,
      { ...identity, expected_revision: original.task.revision },
      'check-live',
      context
    );
    expect(replay).toEqual({ ...first!, replayed: true });
    const beforeRead = await api.detail(taskId, context);
    expect(await api.receipt('reconcile_attempt', 'check-live', taskId, context, old.id)).toEqual({
      kind: 'reconcile_attempt',
      value: { receipt_type: 'reconciliation', receipt: first!.value },
    });
    expect(await api.detail(taskId, context)).toEqual(beforeRead);
    const release = detail.attempts[0].lifecycle!.release!;
    expect(release.evidence).toMatchObject({
      kind: 'native_exit_tombstone',
      instance_id: old.instance_id,
      native_owner_epoch: old.lifecycle!.native_owner_epoch,
    });
    const started = await api.start(
      taskId,
      { agent_kind: 'claude', role: 'lead' },
      detail.task.revision,
      'explicit-replacement',
      context
    );
    detail = await api.detail(taskId, context);
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[1].id).not.toBe(old.id);
    expect(detail.attempts[1].instance_id).not.toBe(old.instance_id);
    expect(started.value.attempt_id).toBe(detail.attempts[1].id);
    expect(detail.results).toEqual(original.results);
    expect(
      detail.operations.filter((operation) => operation.kind === 'deliver_prompt')
    ).toHaveLength(0);
    const output = await transport(record, `/api/sessions/demo/panes/${old.pane_id}/output`, {
      method: 'GET',
      ...context,
    });
    expect(output.body).toEqual({
      result: {
        type: 'pane_read',
        read: {
          output: 'Fictional prior assistant output. No real assistant ran.',
          revision: null,
        },
      },
    });
    expect(
      await rejected(
        api.deliver(
          taskId,
          { attempt_id: old.id, expected_instance_id: old.instance_id!, text: 'Do not resend' },
          detail.task.revision,
          'released-delivery',
          context
        )
      )
    ).toMatchObject({ code: 'not_ready' });
  });

  for (const check of ['interrupted', 'revision_refused'] as const) {
    test(`${check} reconciliation retains reservation but never locks ordinary follow-up`, async () => {
      const api = createWorkApi(
        record,
        'demo',
        createDemoWorkTransport({ lifecycleChecks: [check] })
      );
      const taskId = DEMO_WORK_IDS.lifecycle;
      let detail = await api.detail(taskId, context);
      const attempt = detail.attempts[0];
      await rejected(
        api.reconcile(
          taskId,
          attempt.id,
          {
            expected_revision: detail.task.revision,
            expected_instance_id: attempt.instance_id,
            expected_native_owner_epoch: attempt.lifecycle!.native_owner_epoch,
          },
          'interrupted-check',
          context
        )
      );
      const receipt = await api.receipt(
        'reconcile_attempt',
        'interrupted-check',
        taskId,
        context,
        attempt.id
      );
      expect(receipt).toMatchObject({
        kind: 'reconcile_attempt',
        value: {
          receipt_type: 'operation',
          operation: { state: check === 'interrupted' ? 'unconfirmed' : 'refused' },
        },
      });
      detail = await api.detail(taskId, context);
      expect(detail.attempts[0].lifecycle?.reservation).toBe('reserved');
      expect(
        (
          await api.deliver(
            taskId,
            {
              attempt_id: attempt.id,
              expected_instance_id: attempt.instance_id!,
              text: 'New explicit fictional follow-up',
            },
            detail.task.revision,
            'explicit-follow-up',
            context
          )
        ).value.state
      ).toBe('acknowledged');
      expect((await api.detail(taskId, context)).results).toEqual(detail.results);
    });
  }

  test('production controller keeps current task, selected history and results across separate replacement', async () => {
    const transport = createDemoWorkTransport();
    const writes: { path: string; key: string }[] = [];
    const api = createWorkApi(record, 'demo', async (target, path, request) => {
      if (request.method === 'POST')
        writes.push({ path, key: JSON.parse(request.body!).request_key });
      return transport(target, path, request);
    });
    let key = 0;
    const controller = new WorkController(
      api,
      async () => ({ connected: true, records: true, execution: true, reconciliation: true }),
      () => `lifecycle-${++key}`,
      async () => [{ kind: 'claude', command: 'claude', available: true }]
    );
    controller.activate();
    await controller.refresh();
    await controller.selectTask(DEMO_WORK_IDS.lifecycle);
    controller.selectAttempt(DEMO_WORK_IDS.lifecycleLead);
    controller.selectResult(DEMO_WORK_IDS.lifecycleResult);
    const before = controller.getSnapshot();
    for (const observation of ['live', 'unknown', 'exited'] as const) {
      await controller.checkLifecycle(DEMO_WORK_IDS.lifecycleLead);
      expect(controller.getSnapshot().lifecycleObservation?.observation).toBe(observation);
      if (observation !== 'exited')
        await controller.startReplacement(DEMO_WORK_IDS.lifecycleLead, 'claude');
    }
    expect(writes).toHaveLength(3);
    await controller.startReplacement(DEMO_WORK_IDS.lifecycleLead, 'claude');
    const after = controller.getSnapshot();
    expect(after.selectedAttemptId).toBe(before.selectedAttemptId);
    expect(after.selectedResultId).toBe(before.selectedResultId);
    expect(after.detail?.task.id).toBe(before.detail?.task.id);
    expect(after.detail?.results).toEqual(before.detail?.results);
    expect(after.detail?.attempts).toHaveLength(2);
    expect(after.recipientId).toBe(after.detail!.attempts[1].id);
    expect(writes).toHaveLength(4);
    expect(writes[3].path.endsWith('/attempts')).toBe(true);
    expect(new Set(writes.map((write) => write.key)).size).toBe(4);
  });
});

test('Request changes on the viewed older result prepares the lead draft only explicitly and never overwrites text', async () => {
  const transport = createDemoWorkTransport();
  const writes: string[] = [];
  const api = createWorkApi(record, 'demo', async (target, path, request) => {
    if (request.method === 'POST') writes.push(path);
    return transport(target, path, request);
  });
  let key = 0;
  const controller = new WorkController(
    api,
    async () => ({ connected: true, records: true, execution: true }),
    () => `review-${++key}`
  );
  controller.activate();
  await controller.refresh();
  await controller.selectTask(DEMO_WORK_IDS.review);
  controller.selectAttempt(DEMO_WORK_IDS.worker);
  controller.addressAttempt(DEMO_WORK_IDS.worker);
  controller.selectResult(DEMO_WORK_IDS.firstResult);
  const revision = controller.getSnapshot().detail!.task.revision;
  const review = await controller.review(
    DEMO_WORK_IDS.firstResult,
    revision,
    'changes_requested',
    'Keep the first proposal; fix spacing.'
  );
  expect(review?.submission_id).toBe(DEMO_WORK_IDS.firstResult);
  expect(controller.getSnapshot().draft).toBe('');
  expect(writes).toHaveLength(1);
  expect(controller.prepareReviewFollowup(review!.id)).toBe(true);
  expect(controller.getSnapshot().recipientId).toBe(DEMO_WORK_IDS.lead);
  expect(controller.getSnapshot().selectedAttemptId).toBe(DEMO_WORK_IDS.worker);
  expect(controller.getSnapshot().selectedResultId).toBe(DEMO_WORK_IDS.firstResult);
  expect(controller.getSnapshot().draft).toContain(DEMO_WORK_IDS.firstResult);
  expect(controller.getSnapshot().draft).toContain('Keep the first proposal; fix spacing.');
  expect(writes).toHaveLength(1);
  controller.setDraft('Preserve my existing draft');
  expect(controller.prepareReviewFollowup(review!.id)).toBe(false);
  expect(controller.getSnapshot().draft).toBe('Preserve my existing draft');
  expect(writes).toHaveLength(1);
  expect((await api.detail(DEMO_WORK_IDS.review, context)).operations).toHaveLength(0);
});

describe('fictional exact-assistant interruption (not provider cancellation evidence)', () => {
  test('explicit acknowledged interrupt preserves paused task, prior ambiguous delivery, output and reservation', async () => {
    const transport = createDemoWorkTransport({ interruptOutcome: 'acknowledged' });
    const api = createWorkApi(record, 'demo', transport);
    const original = await api.detail(DEMO_WORK_IDS.uncertain, context);
    const attempt = original.attempts[0];
    await api.setDelegationPaused(
      original.task.id,
      true,
      original.task.revision,
      'pause-before-interrupt',
      context
    );
    const before = await api.detail(original.task.id, context);
    const identity = {
      expected_revision: before.task.revision,
      expected_instance_id: attempt.instance_id!,
      expected_native_owner_epoch: attempt.lifecycle!.native_owner_epoch!,
    };
    const outputPath = `/api/sessions/demo/panes/${attempt.pane_id}/output`;
    const outputBefore = await transport(record, outputPath, { method: 'GET', ...context });
    const requested = await api.interrupt(
      before.task.id,
      attempt.id,
      identity,
      'interrupt-once',
      context
    );
    expect(requested.value.state).toBe('acknowledged');
    expect(requested.value.interruption_receipt).toMatchObject({
      operation_id: requested.value.id,
      launch_id: identity.expected_instance_id,
      owner_epoch: identity.expected_native_owner_epoch,
      key: 'Escape',
      bytes_written: 1,
      input_disposition: 'written',
    });
    const after = await api.detail(before.task.id, context);
    expect(after.operations[0]).toEqual(before.operations[0]);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.results).toEqual(before.results);
    expect(after.task.paused).toBe(true);
    expect(await transport(record, outputPath, { method: 'GET', ...context })).toEqual(
      outputBefore
    );
    expect(
      await api.interrupt(before.task.id, attempt.id, identity, 'interrupt-once', context)
    ).toEqual({ ...requested, replayed: true });
    expect(
      await api.receipt('interrupt_attempt', 'interrupt-once', before.task.id, context, attempt.id)
    ).toEqual({ kind: 'interrupt_attempt', value: requested.value });
    expect(await api.detail(before.task.id, context)).toEqual(after);
  });

  test('unknown interruption is retained on status reads and refuses a second interrupt or same-attempt delivery', async () => {
    const api = createWorkApi(
      record,
      'demo',
      createDemoWorkTransport({ interruptOutcome: 'unconfirmed' })
    );
    const before = await api.detail(DEMO_WORK_IDS.review, context);
    const attempt = before.attempts[0];
    const identity = {
      expected_revision: before.task.revision,
      expected_instance_id: attempt.instance_id!,
      expected_native_owner_epoch: attempt.lifecycle!.native_owner_epoch!,
    };
    const result = await api.interrupt(
      before.task.id,
      attempt.id,
      identity,
      'uncertain-interrupt',
      context
    );
    expect(result.value.state).toBe('unconfirmed');
    expect(result.value.interruption_receipt).toBeUndefined();
    const after = await api.detail(before.task.id, context);
    expect(await api.operation(before.task.id, result.value.id, context)).toEqual(result.value);
    expect(
      await api.receipt(
        'interrupt_attempt',
        'uncertain-interrupt',
        before.task.id,
        context,
        attempt.id
      )
    ).toEqual({ kind: 'interrupt_attempt', value: result.value });
    expect(await api.detail(before.task.id, context)).toEqual(after);
    expect(
      await rejected(
        api.interrupt(
          before.task.id,
          attempt.id,
          { ...identity, expected_revision: after.task.revision },
          'no-repeat',
          context
        )
      )
    ).toMatchObject({ code: 'delivery_unconfirmed' });
    expect(
      await rejected(
        api.deliver(
          before.task.id,
          {
            attempt_id: attempt.id,
            expected_instance_id: attempt.instance_id!,
            text: 'Must not send',
          },
          after.task.revision,
          'blocked-by-interrupt',
          context
        )
      )
    ).toMatchObject({ code: 'delivery_unconfirmed' });
    expect((await api.detail(before.task.id, context)).results).toEqual(before.results);
  });

  test('missing capability or changed launch/epoch refuses before recording an interrupt', async () => {
    for (const variant of ['capability', 'launch', 'epoch'] as const) {
      const api = createWorkApi(
        record,
        'demo',
        createDemoWorkTransport({ interruption: variant !== 'capability' })
      );
      const detail = await api.detail(DEMO_WORK_IDS.review, context);
      const attempt = detail.attempts[0];
      expect(
        await rejected(
          api.interrupt(
            detail.task.id,
            attempt.id,
            {
              expected_revision: detail.task.revision,
              expected_instance_id: variant === 'launch' ? 'foreign-launch' : attempt.instance_id!,
              expected_native_owner_epoch:
                variant === 'epoch' ? 'foreign-epoch' : attempt.lifecycle!.native_owner_epoch!,
            },
            `refused-${variant}`,
            context
          )
        )
      ).toMatchObject({
        code: variant === 'capability' ? 'capability_unavailable' : 'instance_changed',
      });
      expect(await api.detail(detail.task.id, context)).toEqual(detail);
    }
  });
});

test('demo controller interruption keeps selected history/draft and checks uncertainty with GET only', async () => {
  const transport = createDemoWorkTransport({ interruptOutcome: 'unconfirmed' });
  const writes: string[] = [];
  const api = createWorkApi(record, 'demo', async (target, path, request) => {
    if (request.method === 'POST') writes.push(path);
    return transport(target, path, request);
  });
  const controller = new WorkController(
    api,
    async () => ({ connected: true, records: true, execution: true, interruption: true }),
    () => 'one-interruption',
    async () => [],
    {
      load: async () => null,
      save: async () => {},
      loadInterruption: async () => null,
      saveInterruption: async () => {},
    }
  );
  controller.activate();
  await controller.refresh();
  await controller.selectTask(DEMO_WORK_IDS.review);
  controller.selectAttempt(DEMO_WORK_IDS.worker);
  controller.selectResult(DEMO_WORK_IDS.firstResult);
  controller.setDraft('Keep this follow-up unsent');
  const before = controller.getSnapshot();
  await controller.interruptAttempt(DEMO_WORK_IDS.worker);
  expect(controller.getSnapshot().interruption.operation?.state).toBe('unconfirmed');
  expect(controller.getSnapshot().interruption.pending?.attemptId).toBe(DEMO_WORK_IDS.worker);
  await controller.checkInterruptionStatus();
  await controller.interruptAttempt(DEMO_WORK_IDS.worker);
  const after = controller.getSnapshot();
  expect(writes).toHaveLength(1);
  expect(writes[0].endsWith(`/attempts/${DEMO_WORK_IDS.worker}/interruptions`)).toBe(true);
  expect(after.selectedAttemptId).toBe(before.selectedAttemptId);
  expect(after.selectedResultId).toBe(before.selectedResultId);
  expect(after.recipientId).toBe(before.recipientId);
  expect(after.draft).toBe(before.draft);
  expect(after.detail?.results).toEqual(before.detail?.results);
  expect(after.detail?.attempts).toEqual(before.detail?.attempts);
});

test('demo summaries reflect exact immutable review facts through the production decoder', async () => {
  const api = createWorkApi(record, 'demo', createDemoWorkTransport());
  const initial = await api.summaries(context);
  const row = initial.items.find((item) => item.task_id === DEMO_WORK_IDS.review)!;
  expect(row.unreviewed_results).toBe(2);
  expect(row.latest_result).toEqual({ submission_id: DEMO_WORK_IDS.secondResult, review: null });
  expect(
    initial.items.find((item) => item.task_id === DEMO_WORK_IDS.uncertain)
      ?.unresolved_native_operations
  ).toBe(1);
  const detail = await api.detail(DEMO_WORK_IDS.review, context);
  await api.review(
    detail.task.id,
    { submission_id: DEMO_WORK_IDS.firstResult, decision: 'accepted', message: null },
    detail.task.revision,
    'summary-review',
    context
  );
  const updated = (await api.summaries(context)).items.find(
    (item) => item.task_id === detail.task.id
  )!;
  expect(updated.unreviewed_results).toBe(1);
  expect(updated.latest_result?.review).toBeNull();
  expect(updated.last_activity?.kind).toBe('result_reviewed');
});

test('demo summary continuation is pinned and refuses an intervening task mutation', async () => {
  const api = createWorkApi(record, 'demo', createDemoWorkTransport());
  for (let index = 0; index < 16; index++)
    await api.create(input, `summary-create-${index}`, context);
  const first = await api.summaries(context);
  expect(first.items).toHaveLength(20);
  expect(first.next_after_id).not.toBeNull();
  const second = await api.summaries(context, first.next_after_id, first.snapshot_cursor);
  expect(second.items).toHaveLength(2);
  await api.create(input, 'summary-create-conflict', context);
  const failure = await rejected(
    api.summaries(context, first.next_after_id, first.snapshot_cursor)
  );
  expect(failure instanceof WorkApiError && failure.code).toBe('revision_conflict');
});
