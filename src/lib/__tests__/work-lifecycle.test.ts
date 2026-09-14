import { expect, test } from 'bun:test';
import {
  createWorkApi,
  parseWorkDetail,
  parseWorkReconciliation,
  type WorkDetail,
  type WorkOperation,
  type WorkReconciliation,
} from '../work-api';
import { WorkController, type WorkCapabilities } from '../work-controller';
import { createWorkJournal } from '../work-journal';
import { canReplaceWorkAttempt, workOperationBlocksExecution } from '../work-lifecycle';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = {
  serverId: 'gateway',
  label: 'Gateway',
  url: 'https://example.invalid',
  token: 'test',
  pairedAt: 1,
};
const taskId = id(1),
  attemptId = id(2),
  resultId = id(3);
const initial: WorkDetail = {
  task: {
    id: taskId,
    session_id: 'session',
    title: 'Goal',
    brief: 'Do not replay me',
    repo_path: '/repo',
    parent_task_id: null,
    policy: { allowed_agents: ['codex'], max_workers: 0 },
    revision: 1,
    paused: false,
    created_at_ms: 1,
    updated_at_ms: 1,
  },
  attempts: [
    {
      id: attemptId,
      task_id: taskId,
      agent_kind: 'codex',
      role: 'lead',
      instance_id: 'launch-old',
      pane_id: 'pane-old',
      target: 'old',
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
      id: resultId,
      task_id: taskId,
      attempt_id: attemptId,
      summary: 'Pinned result',
      artifacts: [],
      evidence: [],
      created_at_ms: 1,
    },
  ],
  reviews: [],
  cursor: 1,
};
function fixture(
  observations: WorkReconciliation['observation'][] = ['live', 'unknown', 'exited']
) {
  let detail = structuredClone(initial);
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const receipts = new Map<string, unknown>();
  let mode: 'normal' | 'lost_reply' | 'interrupted' = 'normal';
  let capabilities: WorkCapabilities = {
    connected: true,
    records: true,
    execution: true,
    reconciliation: true,
  };
  let count = 10,
    keys = 0,
    disk: string | null = null;
  const journal = createWorkJournal(
    {
      read: async () => disk,
      write: async (value) => {
        disk = value;
      },
    },
    { pairingFingerprint: 'a'.repeat(64), sessionId: 'session' }
  );
  const api = createWorkApi(record, 'session', async (_captured, path, request) => {
    const body = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
    calls.push({ method: request.method, path, body });
    if (request.method === 'GET') {
      if (path.includes('/receipts?'))
        return {
          status: 200,
          body: {
            kind: 'reconcile_attempt',
            value: receipts.get(
              new URL(`https://example.invalid${path}`).searchParams.get('request_key')!
            ),
          },
        };
      if (path.includes('/operations/'))
        return {
          status: 200,
          body: detail.operations.find((operation) => path.endsWith(operation.id)),
        };
      if (path.includes('/tasks?'))
        return { status: 200, body: { tasks: [detail.task], next_after_id: null } };
      return { status: 200, body: structuredClone(detail) };
    }
    const operation: WorkOperation = {
      id: id(count++),
      task_id: taskId,
      attempt_id: attemptId,
      kind: 'reconcile_attempt',
      state: 'acknowledged',
      resources: { ...detail.attempts[0] },
      failure_code: null,
      created_at_ms: 2,
      updated_at_ms: 2,
    };
    if (path.endsWith('/reconciliations')) {
      if (mode === 'interrupted') {
        operation.state = 'unconfirmed';
        detail.operations.push(operation);
        receipts.set(body.request_key as string, { receipt_type: 'operation', operation });
        throw new Error('Process stopped during check');
      }
      const observation = observations.shift() ?? 'unknown';
      const release =
        observation === 'exited'
          ? {
              reason: 'owned_process_exited' as const,
              evidence: {
                kind: 'native_exit_tombstone' as const,
                instance_id: 'launch-old',
                native_owner_epoch: 'epoch',
                native_receipt_id: 'native-receipt',
              },
              reconciliation_operation_id: operation.id,
              released_at_ms: 2,
            }
          : null;
      const receipt: WorkReconciliation = {
        operation_id: operation.id,
        attempt_id: attemptId,
        observation,
        reservation: release ? 'released' : 'reserved',
        release,
        task_revision: ++detail.task.revision,
      };
      detail.attempts[0].lifecycle = {
        ...detail.attempts[0].lifecycle!,
        reservation: receipt.reservation,
        release,
      };
      detail.operations.push(operation);
      receipts.set(body.request_key as string, { receipt_type: 'reconciliation', receipt });
      if (mode === 'lost_reply') throw new Error('Lost completed check response');
      return { status: 200, body: { value: receipt, replayed: false } };
    }
    if (path.endsWith('/attempts')) {
      const replacement = {
        ...detail.attempts[0],
        id: id(count++),
        instance_id: 'launch-new',
        lifecycle: { ...initial.attempts[0].lifecycle! },
      };
      detail.attempts.push(replacement);
      detail.task.revision++;
      operation.attempt_id = replacement.id;
      operation.kind = 'start_attempt';
      operation.resources = replacement;
    } else operation.kind = 'deliver_prompt';
    detail.operations.push(operation);
    return { status: 200, body: { value: operation, replayed: false } };
  });
  const createController = () =>
    new WorkController(
      api,
      async () => capabilities,
      () => `key-${++keys}`,
      async () => [{ kind: 'codex', command: 'codex', available: true }],
      journal
    );
  const controller = createController();
  controller.activate();
  return {
    controller,
    createController,
    calls,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    setCapabilities: (next: WorkCapabilities) => {
      capabilities = next;
    },
    detail: () => detail,
  };
}
async function open(value: ReturnType<typeof fixture>) {
  await value.controller.refresh();
  await value.controller.selectTask(taskId);
}

test('lifecycle decoder refuses forged release evidence and treats missing lifecycle as reserved', () => {
  const legacy = structuredClone(initial);
  delete legacy.attempts[0].lifecycle;
  expect(canReplaceWorkAttempt(parseWorkDetail(legacy, 'session', taskId), attemptId)).toBe(false);
  const forged = structuredClone(initial);
  forged.attempts[0].lifecycle!.reservation = 'released';
  expect(() => parseWorkDetail(forged, 'session', taskId)).toThrow();
  expect(() =>
    parseWorkReconciliation(
      {
        operation_id: id(10),
        attempt_id: attemptId,
        observation: 'live',
        reservation: 'released',
        release: null,
        task_revision: 2,
      },
      attemptId
    )
  ).toThrow();
});

test('live and unknown stay reserved; released replacement is a separate start with pinned history and no prompt', async () => {
  const value = fixture();
  await open(value);
  const pinned = value.controller.getSnapshot().detail!.results;
  for (const observation of ['live', 'unknown'] as const) {
    await value.controller.checkLifecycle(attemptId);
    expect(value.controller.getSnapshot().lifecycleObservation?.observation).toBe(observation);
    await value.controller.startReplacement(attemptId, 'codex');
    expect(value.calls.filter((call) => call.path.endsWith('/attempts'))).toHaveLength(0);
  }
  await value.controller.checkLifecycle(attemptId);
  expect(canReplaceWorkAttempt(value.controller.getSnapshot().detail!, attemptId)).toBe(true);
  await value.controller.startReplacement(attemptId, 'codex');
  expect(value.calls.filter((call) => call.path.endsWith('/attempts'))).toHaveLength(1);
  expect(value.calls.filter((call) => call.path.endsWith('/deliveries'))).toHaveLength(0);
  expect(value.controller.getSnapshot().selectedAttemptId).toBe(attemptId);
  expect(value.controller.getSnapshot().selectedResultId).toBe(resultId);
  expect(value.controller.getSnapshot().detail!.results).toBe(pinned);
  expect(value.controller.getSnapshot().recipientId === attemptId).toBe(false);
  expect(canReplaceWorkAttempt(value.controller.getSnapshot().detail!, attemptId)).toBe(false);
});

test('restored reconciliation uses the saved key and only GET; interrupted checks do not lock ordinary input forever', async () => {
  for (const mode of ['lost_reply', 'interrupted'] as const) {
    const value = fixture(['exited']);
    await open(value);
    value.setMode(mode);
    await value.controller.checkLifecycle(attemptId);
    const pending = value.controller.getSnapshot().pending;
    expect(pending).toMatchObject({
      kind: 'reconcile',
      attemptId,
      expectedInstanceId: 'launch-old',
      expectedNativeOwnerEpoch: 'epoch',
    });
    value.controller.deactivate();
    const restored = value.createController();
    restored.activate();
    const before = value.calls.filter((call) => call.method === 'POST').length;
    await restored.refresh();
    expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(before);
    expect(restored.getSnapshot().pending).toBe(null);
    if (mode === 'interrupted') {
      expect(
        value
          .detail()
          .operations.some((operation) =>
            workOperationBlocksExecution(operation, value.detail().attempts)
          )
      ).toBe(false);
      restored.setDraft('New explicit instruction');
      await restored.deliver();
      expect(value.calls.at(-1)?.path.endsWith('/deliveries')).toBe(true);
      value.setMode('normal');
      await restored.refresh();
      await restored.checkLifecycle(attemptId);
      expect(
        value.calls
          .filter((call) => call.path.endsWith('/reconciliations'))
          .map((call) => call.body.request_key)
      ).toEqual(['key-1', 'key-3']);
    }
  }
});

test('fresh lifecycle capability loss causes zero reconciliation POSTs', async () => {
  const value = fixture();
  await open(value);
  value.setCapabilities({ connected: true, records: true, execution: true });
  await value.controller.checkLifecycle(attemptId);
  expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});

test('paused tasks may verify exit but cannot start a replacement', async () => {
  const value = fixture(['exited']);
  value.detail().task.paused = true;
  await open(value);
  await value.controller.checkLifecycle(attemptId);
  expect(value.controller.getSnapshot().lifecycleObservation?.reservation).toBe('released');
  await value.controller.startReplacement(attemptId, 'codex');
  expect(value.calls.filter((call) => call.path.endsWith('/attempts'))).toHaveLength(0);
});
