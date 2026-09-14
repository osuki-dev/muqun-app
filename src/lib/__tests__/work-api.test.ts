import { describe, expect, test } from 'bun:test';
import {
  createWorkApi,
  parseWorkChanges,
  parseWorkDetail,
  parseWorkOperation,
  parseWorkRecordPage,
  parseWorkTask,
  WorkApiError,
  workOperationRecovery,
  type WorkDetail,
  type WorkOperation,
  type WorkTask,
  type WorkTransport,
} from '../work-api';
import type { GatewayRecord } from '../gateway-storage';
import { parseWorkDelegationState } from '../work-delegation';
const taskId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const resultId = '44444444-4444-4444-8444-444444444444';
const task: WorkTask = {
  id: taskId,
  session_id: 'session/a',
  repo_path: '/repo',
  title: 'Improve UI',
  brief: 'Preserve the terminal',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 1 },
  revision: 1,
  created_at_ms: 1,
  updated_at_ms: 1,
  paused: false,
};
const resources = { instance_id: null, target: null, pane_id: null, worktree_path: null };
const operation: WorkOperation = {
  id: operationId,
  task_id: taskId,
  attempt_id: attemptId,
  kind: 'start_attempt',
  state: 'acknowledged',
  resources,
  failure_code: null,
  created_at_ms: 1,
  updated_at_ms: 1,
};
const detail: WorkDetail = {
  task,
  attempts: [
    {
      ...resources,
      id: attemptId,
      task_id: taskId,
      agent_kind: 'codex',
      role: 'lead',
      created_at_ms: 1,
    },
  ],
  operations: [operation],
  results: [],
  reviews: [],
  cursor: 1,
};
const record: GatewayRecord = {
  serverId: 'A',
  label: 'Host A',
  url: 'https://a.invalid',
  token: 'a',
  pairedAt: 1,
  sshTunnel: { hostId: 'ssh-a', remoteHost: '127.0.0.1', remotePort: 8765 },
};
const context = { isCurrent: () => true };

test('frozen task inputs validate metadata and mutation acknowledgements preserve exact chosen references', async () => {
  const ref = {
    input_id: resultId,
    caption: 'Reference screenshot',
    use: 'reference-only' as const,
  };
  const frozen = {
    ...ref,
    name: 'screen.png',
    mime: 'image/png',
    size_bytes: 12,
    sha256: 'a'.repeat(64),
  };
  expect(parseWorkTask({ ...task, input_refs: [frozen] }, task.session_id).input_refs?.[0]).toEqual(
    frozen
  );
  expect(() =>
    parseWorkTask({ ...task, input_refs: [{ ...frozen, sha256: 'bad' }] }, task.session_id)
  ).toThrow();
  expect(() => parseWorkTask({ ...task, input_refs: [frozen, frozen] }, task.session_id)).toThrow();
  let returned = { ...task, input_refs: [frozen] };
  let posts = 0;
  const api = createWorkApi(record, task.session_id, async () => {
    posts++;
    return { status: 200, body: { value: returned, replayed: false } };
  });
  expect(
    (await api.create({ ...task, input_refs: [ref] }, 'first', context)).value.input_refs?.[0].name
  ).toBe('screen.png');
  returned = { ...returned, input_refs: [{ ...frozen, caption: 'Silently replaced' }] };
  const failure = await api
    .create({ ...task, input_refs: [ref] }, 'second', context)
    .catch((error: unknown) => error);
  expect(failure instanceof WorkApiError).toBe(true);
  expect((failure as WorkApiError).outcome).toBe('unconfirmed');
  expect(posts).toBe(2);
});

test('immutable historical result lookup never substitutes a newer result', async () => {
  const historical = {
    id: resultId,
    task_id: taskId,
    attempt_id: attemptId,
    summary: 'Reviewed version',
    artifacts: [],
    evidence: [],
    created_at_ms: 1,
  };
  let response = historical;
  const paths: string[] = [];
  const api = createWorkApi(record, 'session/a', async (_record, path) => {
    paths.push(path);
    return { status: 200, body: response };
  });
  expect((await api.result(taskId, resultId, context)).summary).toBe('Reviewed version');
  expect(paths[0].endsWith(`/results/${resultId}`)).toBe(true);
  response = { ...historical, id: operationId };
  await expect(api.result(taskId, resultId, context)).rejects.toThrow();
});

test('paged detail retains continuation metadata and permits references on unseen pages', () => {
  const page = { snapshot_revision: 1, after_id: null, next_after_id: null, has_more: false };
  const first = {
    ...detail,
    pages: {
      attempts: { ...page, next_after_id: attemptId, has_more: true },
      operations: page,
      results: page,
      reviews: page,
    },
  };
  first.operations = [{ ...operation, attempt_id: resultId }];
  expect(parseWorkDetail(first, 'session/a', taskId).pages?.attempts.has_more).toBe(true);
  expect(() =>
    parseWorkDetail({ ...first, pages: { ...first.pages, attempts: page } }, 'session/a', taskId)
  ).toThrow();
  expect(parseWorkDetail(detail, 'session/a', taskId).pages).toBeUndefined();
});

test('record pages reject changed revisions, foreign scope and nonadvancing cursors', () => {
  const page = { snapshot_revision: 1, after_id: null, next_after_id: operationId, has_more: true };
  expect(
    parseWorkRecordPage({ items: [operation], page }, 'operation', taskId, 1, null).items[0].id
  ).toBe(operationId);
  expect(() =>
    parseWorkRecordPage({ items: [operation], page }, 'operation', taskId, 2, null)
  ).toThrow();
  expect(() =>
    parseWorkRecordPage({ items: [operation], page }, 'operation', resultId, 1, null)
  ).toThrow();
  expect(() =>
    parseWorkRecordPage(
      { items: [operation], page: { ...page, after_id: operationId } },
      'operation',
      taskId,
      1,
      operationId
    )
  ).toThrow();
});

describe('work payload validation', () => {
  test('rejects foreign session/task identities, malformed UUIDs, huge and fractional revisions', () => {
    expect(parseWorkTask(task, 'session/a')).toEqual({
      ...task,
      delegation: parseWorkDelegationState(undefined),
      dependencies: [],
    });
    for (const value of [
      { ...task, session_id: 'b' },
      { ...task, id: 'pane-1' },
      { ...task, revision: Infinity },
      { ...task, revision: 0.5 },
      { ...task, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...task, brief: 'x'.repeat(65537) },
    ])
      expect(() => parseWorkTask(value, 'session/a')).toThrow();
    expect(() => parseWorkTask(task, 'session/a', attemptId)).toThrow();
  });
  test('validates enums and relationships instead of trusting nested arrays', () => {
    expect(parseWorkDetail(detail, 'session/a', taskId)).toEqual({
      ...detail,
      task: { ...task, delegation: parseWorkDelegationState(undefined), dependencies: [] },
    });
    for (const value of [
      { ...detail, operations: [{ ...operation, state: 'done' }] },
      { ...detail, operations: [{ ...operation, attempt_id: resultId }] },
      { ...detail, attempts: [detail.attempts[0], detail.attempts[0]] },
      { ...detail, attempts: [{ ...detail.attempts[0], task_id: resultId }] },
      {
        ...detail,
        results: [
          {
            id: resultId,
            task_id: taskId,
            attempt_id: attemptId,
            summary: 'Result',
            artifacts: [{ path: '/repo/result.png', sha256: 'not-a-hash', size_bytes: 1 }],
            evidence: [],
            created_at_ms: 1,
          },
        ],
      },
    ])
      expect(() => parseWorkDetail(value, 'session/a', taskId)).toThrow();
  });
  test('change cursors must advance monotonically and not exceed the response cursor', () => {
    const change = {
      cursor: 2,
      task_id: taskId,
      revision: 2,
      kind: 'task_changed',
      entity_id: taskId,
    };
    expect(
      parseWorkChanges({ changes: [change], cursor: 2, reset_required: false }, 1).cursor
    ).toBe(2);
    for (const page of [
      { changes: [change, change], cursor: 2, reset_required: false },
      { changes: [change], cursor: 1, reset_required: false },
      { changes: [], cursor: 0, reset_required: false },
    ])
      expect(() => parseWorkChanges(page, 1)).toThrow();
    expect(
      parseWorkChanges({ changes: [], cursor: 0, reset_required: true }, 100).reset_required
    ).toBe(true);
  });
  test('operation lookup cannot substitute another receipt or task', () => {
    expect(() => parseWorkOperation(operation, taskId, resultId)).toThrow();
    expect(() => parseWorkOperation(operation, resultId, operationId)).toThrow();
  });
  test('uncertainty offers status/inspection, never automatic replay', () => {
    expect(workOperationRecovery({ ...operation, state: 'unconfirmed' })).toBe('check_status');
    expect(
      workOperationRecovery({
        ...operation,
        state: 'unconfirmed',
        resources: { ...resources, pane_id: 'p1' },
      })
    ).toBe('inspect_resources');
    expect(workOperationRecovery({ ...operation, state: 'refused' })).toBe('resolve_refusal');
    expect(workOperationRecovery(operation)).toBe('none');
  });
});

describe('bound work client', () => {
  test('pause uses the displayed revision and validates its exact task acknowledgement', async () => {
    const calls: { path: string; body: unknown }[] = [];
    let response = { ...task, paused: true, revision: 2 };
    const transport: WorkTransport = async (_record, path, request) => {
      calls.push({ path, body: JSON.parse(request.body ?? '{}') });
      return { status: 200, body: { value: response, replayed: false } };
    };
    const client = createWorkApi(record, task.session_id, transport);
    const receipt = await client.setDelegationPaused(taskId, true, 1, 'pause', context);
    expect(receipt.value.paused).toBe(true);
    expect(calls[0]).toEqual({
      path: `/api/sessions/session%2Fa/work/tasks/${taskId}/delegation`,
      body: { paused: true, expected_revision: 1, request_key: 'pause' },
    });
    response = { ...response, paused: false };
    const failure = await client
      .setDelegationPaused(taskId, true, 1, 'wrong-receipt', context)
      .catch((error: unknown) => error);
    expect(failure instanceof WorkApiError).toBe(true);
    expect((failure as WorkApiError).outcome).toBe('unconfirmed');
    expect(calls).toHaveLength(2);
  });
  test('a single-assistant task may explicitly forbid worker delegation', () => {
    const noWorkers = { ...task, policy: { allowed_agents: ['codex'], max_workers: 0 } };
    expect(parseWorkTask(noWorkers, task.session_id).policy.max_workers).toBe(0);
    expect(() =>
      parseWorkTask(
        { ...noWorkers, policy: { ...noWorkers.policy, max_workers: -1 } },
        task.session_id
      )
    ).toThrow();
  });
  test('captures pairing, tunnel, session and caller key before mutable navigation changes', async () => {
    const mutable = { ...record, sshTunnel: { ...record.sshTunnel! } };
    const calls: { record: GatewayRecord; path: string; body: unknown }[] = [];
    const transport: WorkTransport = async (bound, path, request) => {
      calls.push({ record: bound, path, body: JSON.parse(request.body!) });
      return { status: 200, body: { value: task, replayed: false } };
    };
    const client = createWorkApi(mutable, 'session/a', transport);
    mutable.token = 'b';
    mutable.sshTunnel.hostId = 'ssh-b';
    await client.create(task, 'stable-key', context);
    expect(calls).toHaveLength(1);
    expect(calls[0].record.token).toBe('a');
    expect(calls[0].record.sshTunnel?.hostId).toBe('ssh-a');
    expect(calls[0].path).toBe('/api/sessions/session%2Fa/work/tasks');
    expect(calls[0].body).toMatchObject({ request_key: 'stable-key', repo_path: '/repo' });
  });
  test('stale ownership and aborted calls make zero requests', async () => {
    let calls = 0;
    const client = createWorkApi(record, 'session/a', async () => {
      calls++;
      return { status: 200, body: detail };
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.detail(taskId, { ...context, signal: controller.signal })
    ).rejects.toThrow();
    await expect(client.detail(taskId, { isCurrent: () => false })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  test('lost mutation reply retains request key and never retries', async () => {
    let calls = 0;
    const client = createWorkApi(record, 'session/a', async () => {
      calls++;
      throw new Error('socket closed');
    });
    try {
      await client.create(task, 'stable-key', context);
      throw new Error('unexpected success');
    } catch (error) {
      expect(error instanceof WorkApiError).toBe(true);
      expect(error).toMatchObject({ outcome: 'unconfirmed', requestKey: 'stable-key' });
    }
    expect(calls).toBe(1);
  });
  test('409 is a refusal; timeout and malformed acknowledgement remain unconfirmed', async () => {
    for (const [status, body, outcome] of [
      [409, { error: { code: 'revision_conflict', message: 'secret' } }, 'refused'],
      [408, { error: { code: 'timeout' } }, 'unconfirmed'],
      [200, { value: { ...task, session_id: 'foreign' }, replayed: false }, 'unconfirmed'],
    ] as const) {
      const client = createWorkApi(record, 'session/a', async () => ({ status, body }));
      try {
        await client.create(task, 'key', context);
        throw new Error('unexpected success');
      } catch (error) {
        expect(error).toMatchObject({ outcome });
        expect(String(error)).not.toContain('secret');
      }
    }
  });
  test('a late read is dropped but a confirmed mutation receipt survives navigation', async () => {
    let current = true;
    const client = createWorkApi(record, 'session/a', async (_record, _path, request) => {
      current = false;
      return {
        status: 200,
        body: request.method === 'GET' ? detail : { value: task, replayed: false },
      };
    });
    await expect(client.detail(taskId, { isCurrent: () => current })).rejects.toThrow();
    current = true;
    expect((await client.create(task, 'key', { isCurrent: () => current })).value.id).toBe(taskId);
  });
  test('follow-up requires its exact operation kind and attempt', async () => {
    let calls = 0;
    const client = createWorkApi(record, 'session/a', async () => {
      calls++;
      return { status: 200, body: { value: operation, replayed: false } };
    });
    await expect(
      client.deliver(
        taskId,
        { attempt_id: attemptId, expected_instance_id: 'native-a', text: 'Continue' },
        1,
        'key',
        context
      )
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
