import { expect, test } from 'bun:test';
import {
  createWorkApi,
  parseWorkOperation,
  type WorkDetail,
  type WorkOperation,
  type WorkTransport,
} from '../work-api';
import { WorkController, workCapabilities } from '../work-controller';
import { createWorkJournal, type PendingWorkIntent, type WorkJournalPort } from '../work-journal';
import { workOperationBlocksExecution } from '../work-lifecycle';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = {
  serverId: 'gateway',
  label: 'Test',
  url: 'https://example.invalid',
  token: 'paired',
  pairedAt: 1,
};
const binding = {
  instance_id: 'launch',
  pane_id: 'pane',
  target: 'target',
  worktree_path: '/repo',
};
const detail: WorkDetail = {
  task: {
    id: id(1),
    session_id: 'session',
    title: 'Task',
    brief: 'Goal',
    repo_path: '/repo',
    parent_task_id: null,
    policy: { allowed_agents: ['codex'], max_workers: 1 },
    revision: 4,
    created_at_ms: 1,
    updated_at_ms: 1,
    paused: true,
  },
  attempts: [
    {
      ...binding,
      id: id(2),
      task_id: id(1),
      agent_kind: 'codex',
      role: 'lead',
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
      task_id: id(1),
      attempt_id: id(2),
      summary: 'Pinned result',
      evidence: [],
      artifacts: [],
      created_at_ms: 1,
    },
  ],
  reviews: [],
  cursor: 4,
};
const operation: WorkOperation = {
  id: id(4),
  task_id: id(1),
  attempt_id: id(2),
  kind: 'interrupt_attempt',
  state: 'acknowledged',
  resources: binding,
  failure_code: null,
  created_at_ms: 2,
  updated_at_ms: 2,
  interruption_receipt: {
    operation_id: id(4),
    launch_id: 'launch',
    owner_epoch: 'epoch',
    receipt_id: 'receipt',
    key: 'Escape',
    bytes_written: 1,
    input_disposition: 'written',
  },
};
function journal() {
  let raw: string | null = null;
  return createWorkJournal(
    {
      read: async () => raw,
      write: async (value) => {
        raw = value;
      },
    },
    { pairingFingerprint: 'a'.repeat(64), sessionId: 'session' }
  );
}
async function setup(
  options: {
    journal?: WorkJournalPort;
    primary?: PendingWorkIntent;
    lost?: boolean;
    response?: WorkOperation;
    beforePost?: () => Promise<void>;
  } = {}
) {
  const storage = options.journal ?? journal();
  if (options.primary) await storage.save(options.primary);
  let available = true;
  let receiptVisible = true;
  const calls: { path: string; method: string }[] = [];
  const transport: WorkTransport = async (_record, path, request) => {
    calls.push({ path, method: request.method });
    if (path.includes('/tasks?'))
      return { status: 200, body: { tasks: [detail.task], next_after_id: null } };
    if (path.includes('/operations/'))
      return {
        status: 200,
        body: {
          ...operation,
          id: id(5),
          kind: 'deliver_prompt',
          state: 'unconfirmed',
          interruption_receipt: undefined,
        },
      };
    if (request.method === 'POST') {
      await options.beforePost?.();
      if (options.lost) throw new Error('Reply lost after write');
      return { status: 200, body: { value: options.response ?? operation, replayed: false } };
    }
    if (path.includes('/receipts?')) {
      if (!receiptVisible)
        return {
          status: 404,
          body: { error: { code: 'not_found', message: 'No receipt visible' } },
        };
      if (path.includes('kind=deliver_prompt'))
        return {
          status: 200,
          body: {
            kind: 'deliver_prompt',
            value: {
              ...operation,
              id: id(5),
              kind: 'deliver_prompt',
              state: 'unconfirmed',
              interruption_receipt: undefined,
            },
          },
        };
      return {
        status: 200,
        body: { kind: 'interrupt_attempt', value: options.response ?? operation },
      };
    }
    return { status: 200, body: detail };
  };
  const controller = new WorkController(
    createWorkApi(record, 'session', transport),
    async () => ({ connected: true, records: true, execution: true, interruption: available }),
    () => 'interrupt-key',
    undefined,
    storage
  );
  controller.activate();
  await controller.refresh();
  await controller.selectTask(id(1));
  controller.setDraft('Preserve this instruction');
  return {
    controller,
    storage,
    calls,
    setAvailable: (value: boolean) => {
      available = value;
    },
    setReceiptVisible: (value: boolean) => {
      receiptVisible = value;
    },
  };
}

test('interruption capability is selected-session native connectivity gated and independent of execution support', () => {
  const health = {
    serverId: 'gateway',
    backends: [
      {
        sessionId: 'session',
        connected: true,
        capabilities: ['work_tasks_v1', 'work_interrupt_v1'],
      },
    ],
  };
  expect(workCapabilities(health, 'gateway', 'session').interruption).toBe(true);
  expect(workCapabilities(health, 'gateway', 'session').execution).toBe(false);
  health.backends[0].connected = false;
  expect(workCapabilities(health, 'gateway', 'session').interruption).toBeUndefined();
});
test('acknowledgement requires exact single-byte interruption evidence and rejects wrong receipt fields', () => {
  expect(parseWorkOperation(operation, id(1)).interruption_receipt?.bytes_written).toBe(1);
  for (const patch of [
    { operation_id: id(9) },
    { launch_id: 'other' },
    { key: 'Enter' },
    { bytes_written: 2 },
    { input_disposition: 'queued' },
    { receipt_id: '' },
  ]) {
    expect(() =>
      parseWorkOperation(
        { ...operation, interruption_receipt: { ...operation.interruption_receipt, ...patch } },
        id(1)
      )
    ).toThrow();
  }
  expect(() => parseWorkOperation({ ...operation, interruption_receipt: null }, id(1))).toThrow();
});
test('paused task can interrupt despite uncertain delivery while preserving both task history and primary recovery key', async () => {
  const primary: PendingWorkIntent = {
    kind: 'deliver',
    taskId: id(1),
    requestKey: 'delivery-key',
    state: 'unconfirmed',
  };
  const value = await setup({ primary });
  const before = value.controller.getSnapshot();
  await value.controller.interruptAttempt(id(2));
  const after = value.controller.getSnapshot();
  expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(after.interruption.operation?.state).toBe('acknowledged');
  expect(after.interruption.pending).toBe(null);
  expect(after.pending).toEqual(before.pending);
  expect(await value.storage.load()).toEqual(before.pending);
  expect(after.draft).toBe(before.draft);
  expect(after.selectedAttemptId).toBe(before.selectedAttemptId);
  expect(after.selectedResultId).toBe(before.selectedResultId);
  expect(after.detail?.results).toBe(before.detail?.results);
  expect(after.detail?.attempts).toBe(before.detail?.attempts);
});
test('lost interrupt acknowledgement retains independent key, double taps do not replay, recovery is GET-only', async () => {
  const primary: PendingWorkIntent = {
    kind: 'deliver',
    taskId: id(1),
    requestKey: 'delivery-key',
    state: 'unconfirmed',
  };
  const value = await setup({ primary, lost: true });
  await Promise.all([
    value.controller.interruptAttempt(id(2)),
    value.controller.interruptAttempt(id(2)),
  ]);
  expect(value.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(value.controller.getSnapshot().interruption.pending?.state).toBe('unconfirmed');
  const restored = await setup({ journal: value.storage });
  restored.setReceiptVisible(false);
  await restored.controller.checkInterruptionStatus();
  await restored.controller.interruptAttempt(id(2));
  expect(restored.controller.getSnapshot().interruption.pending?.requestKey).toBe('interrupt-key');
  restored.setReceiptVisible(true);
  await restored.controller.checkInterruptionStatus();
  expect(restored.calls.every((call) => call.method === 'GET')).toBe(true);
  expect(restored.controller.getSnapshot().interruption.pending).toBe(null);
  expect((await restored.storage.load())?.requestKey).toBe(primary.requestKey);
});
test('wrong epoch acknowledgement stays unconfirmed and storage refusal or capability loss dispatches nothing', async () => {
  const forged = await setup({
    response: {
      ...operation,
      interruption_receipt: { ...operation.interruption_receipt!, owner_epoch: 'foreign' },
    },
  });
  await forged.controller.interruptAttempt(id(2));
  expect(forged.controller.getSnapshot().interruption.pending?.state).toBe('unconfirmed');
  const unavailable = await setup();
  unavailable.setAvailable(false);
  await unavailable.controller.interruptAttempt(id(2));
  expect(unavailable.calls.some((call) => call.method === 'POST')).toBe(false);
  const backing = journal();
  const failed = await setup({
    journal: {
      ...backing,
      saveInterruption: async () => {
        throw new Error('Storage full');
      },
    },
  });
  await failed.controller.interruptAttempt(id(2));
  expect(failed.calls.some((call) => call.method === 'POST')).toBe(false);
  expect(failed.controller.getSnapshot().interruption.error).toBe('journal_unavailable');
});
test('late interruption acknowledgement preserves draft and does not navigate back to a dismissed task', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const value = await setup({ beforePost: () => wait });
  value.controller.setDraft('Keep my follow-up');
  const before = value.controller.getSnapshot();
  const action = value.controller.interruptAttempt(id(2));
  for (let turn = 0; turn < 100 && !value.calls.some((call) => call.method === 'POST'); turn++)
    await Promise.resolve();
  expect(value.calls.some((call) => call.method === 'POST')).toBe(true);
  value.controller.showList();
  release();
  await action;
  const after = value.controller.getSnapshot();
  expect(after.view).toBe('list');
  expect(after.detail?.task).toBe(before.detail?.task);
  expect(after.detail?.attempts).toBe(before.detail?.attempts);
  expect(after.detail?.results).toBe(before.detail?.results);
  expect(after.detail?.reviews).toBe(before.detail?.reviews);
  expect(after.detail?.cursor).toBe(before.detail?.cursor);
  expect(after.detail?.operations.find((item) => item.id === operation.id)?.state).toBe(
    'acknowledged'
  );
  expect(after.selectedAttemptId).toBe(before.selectedAttemptId);
  expect(after.selectedResultId).toBe(before.selectedResultId);
  expect(after.recipientId).toBe(before.recipientId);
  expect(after.draft).toBe('Keep my follow-up');
  expect(value.controller.getSnapshot().interruption.operation?.state).toBe('acknowledged');
  expect(value.controller.getSnapshot().interruption.pending).toBe(null);
});
test('uncertain interruption fences only its own live attempt and never implies reservation release', () => {
  const uncertain = {
    ...operation,
    state: 'unconfirmed' as const,
    interruption_receipt: undefined,
  };
  expect(workOperationBlocksExecution(uncertain, detail.attempts, id(2))).toBe(true);
  expect(workOperationBlocksExecution(uncertain, detail.attempts, id(8))).toBe(false);
  expect(detail.attempts[0].lifecycle?.reservation).toBe('reserved');
});
