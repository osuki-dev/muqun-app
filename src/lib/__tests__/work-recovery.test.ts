import { expect, test } from 'bun:test';
import { createDemoWorkTransport } from '../demo-work';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import { createWorkApi, type WorkTask } from '../work-api';
import { WorkController, type PendingWorkAction } from '../work-controller';

const record = {
  serverId: DEMO_PAIRING_SERVER_ID,
  label: 'Demo',
  url: 'https://demo.invalid',
  token: 'demo',
  pairedAt: 0,
};
const input = {
  repo_path: '/demo/homepage',
  title: 'Recovery task',
  brief: 'Keep my intent',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 0 },
};

test('lost creation reply recovers by request key without replay or automatic startup', async () => {
  const transport = createDemoWorkTransport();
  let receipt: WorkTask | null = null;
  let visible = false;
  let posts = 0;
  let saved: PendingWorkAction | null = null;
  const methods: string[] = [];
  const api = createWorkApi(record, 'demo', async (captured, path, request) => {
    methods.push(request.method);
    if (path.includes('/receipts?'))
      return visible
        ? { status: 200, body: { kind: 'create_task', value: receipt } }
        : { status: 404, body: { error: { code: 'not_found', message: 'Not visible' } } };
    const reply = await transport(captured, path, request);
    if (request.method === 'POST') {
      expect(saved?.requestKey).toBe(JSON.parse(request.body!).request_key);
      posts++;
      receipt = (reply.body as { value: WorkTask }).value;
      throw new Error('Lost committed response');
    }
    return reply;
  });
  let keys = 0;
  const reconstruct = () =>
    new WorkController(
      api,
      async () => ({ connected: true, records: true, execution: true }),
      () => `key-${++keys}`,
      async () => [{ kind: 'codex', command: 'codex', available: true }],
      {
        load: async () => saved,
        save: async (pending) => {
          saved = pending;
        },
      }
    );
  let controller = reconstruct();
  controller.activate();
  expect(await controller.startGoal(input)).toBe(false);
  expect(controller.getSnapshot().pending).toMatchObject({
    requestKey: 'key-1',
    taskId: null,
    state: 'unconfirmed',
  });
  controller.deactivate();
  controller = reconstruct();
  controller.activate();
  await controller.refresh();
  await controller.startGoal(input);
  expect(posts).toBe(1);
  expect(controller.getSnapshot().pending?.state).toBe('unconfirmed');
  visible = true;
  await controller.refresh();
  expect(controller.getSnapshot().pending).toBe(null);
  expect(controller.getSnapshot().detail?.task.title).toBe(input.title);
  expect(controller.getSnapshot().detail?.attempts).toHaveLength(0);
  await controller.startGoal(input);
  expect(posts).toBe(1);
  expect(methods.filter((method) => method === 'POST')).toHaveLength(1);
});

test('journal load or write failure blocks every mutation', async () => {
  for (const phase of ['load', 'save']) {
    let posts = 0;
    const api = createWorkApi(record, 'demo', async () => {
      posts++;
      throw new Error('Unexpected transport');
    });
    const controller = new WorkController(
      api,
      async () => ({ connected: true, records: true, execution: true }),
      () => 'key',
      async () => [{ kind: 'codex', command: 'codex', available: true }],
      {
        load: async () => {
          if (phase === 'load') throw new Error('Storage unavailable');
          return null;
        },
        save: async () => {
          throw new Error('Storage unavailable');
        },
      }
    );
    controller.activate();
    expect(await controller.startGoal(input)).toBe(false);
    expect(posts).toBe(0);
    expect(controller.getSnapshot().error).toBe('journal_unavailable');
  }
});

test('receipt lookup rejects a foreign session or operation kind', async () => {
  const transport = createDemoWorkTransport();
  const client = createWorkApi(record, 'demo', transport);
  const { value: task } = await client.create(input, 'create', { isCurrent: () => true });
  const wrongSession = createWorkApi(record, 'demo', async () => ({
    status: 200,
    body: { kind: 'create_task', value: { ...task, session_id: 'foreign' } },
  }));
  await expect(
    wrongSession.receipt('create_task', 'create', null, { isCurrent: () => true })
  ).rejects.toThrow();
  const wrongKind = createWorkApi(record, 'demo', async () => ({
    status: 200,
    body: { kind: 'pause_task', value: task },
  }));
  await expect(
    wrongKind.receipt('create_task', 'create', null, { isCurrent: () => true })
  ).rejects.toThrow();
});
