import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDemoWorkTransport } from '../../demo-work';
import { DEMO_PAIRING_SERVER_ID } from '../../pairing';
import { createWorkApi, type WorkTask } from '../../work-api';
import { WorkController } from '../../work-controller';
import { createWorkJournal, type WorkJournalStorage } from '../../work-journal';

const phase = process.argv[2];
const directory = process.argv[3];
if (!directory || (phase !== 'write' && phase !== 'recover'))
  throw new Error('Invalid fixture phase');
const journalPath = join(directory, 'journal.json');
const receiptPath = join(directory, 'server-receipt.json');
const storage: WorkJournalStorage = {
  read: async () => {
    try {
      return await readFile(journalPath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  },
  write: (value) => writeFile(journalPath, value, { mode: 0o600 }),
};
const owner = { pairingFingerprint: 'a'.repeat(64), sessionId: 'demo' };
const record = {
  serverId: DEMO_PAIRING_SERVER_ID,
  label: 'Demo',
  url: 'https://demo.invalid',
  token: 'never-journal-this-credential',
  deviceId: 'paired-actor',
  pairedAt: 0,
};
const input = {
  repo_path: '/demo/homepage',
  title: 'Restart recovery',
  brief: 'Never journal this user prompt',
  parent_task_id: null,
  policy: { allowed_agents: ['codex'], max_workers: 0 },
};
let posts = 0;
let keysGenerated = 0;
let visible = false;
const lookupActors: string[] = [];
const lookupKeys: string[] = [];
const backend = createDemoWorkTransport();
const persisted: { task: WorkTask; detail: unknown } | null =
  phase === 'recover' ? JSON.parse(await readFile(receiptPath, 'utf8')) : null;
const api = createWorkApi(record, 'demo', async (captured, path, request) => {
  if (request.method === 'POST') {
    posts++;
    if (phase === 'recover') throw new Error('Recovery attempted a forbidden POST');
    const response = await backend(captured, path, request);
    const task = (response.body as { value: WorkTask }).value;
    const detail = await backend(captured, `${path}/${task.id}`, {
      ...request,
      method: 'GET',
      body: undefined,
    });
    await writeFile(receiptPath, JSON.stringify({ task, detail: detail.body }));
    throw new Error('Committed server reply was lost');
  }
  if (path.includes('/receipts?')) {
    lookupActors.push(captured.deviceId ?? 'missing-actor');
    lookupKeys.push(new URL(path, captured.url).searchParams.get('request_key') ?? 'missing-key');
    return visible && persisted
      ? { status: 200, body: { kind: 'create_task', value: persisted.task } }
      : {
          status: 404,
          body: { error: { code: 'not_found', message: 'No committed receipt visible yet' } },
        };
  }
  if (persisted && path.includes(`/tasks/${persisted.task.id}`))
    return { status: 200, body: persisted.detail };
  if (persisted && path.endsWith('/tasks'))
    return { status: 200, body: { tasks: [persisted.task], next_after_id: null } };
  return backend(captured, path, request);
});
const controller = new WorkController(
  api,
  async () => ({ connected: true, records: true, execution: true }),
  () => `persisted-key-${++keysGenerated}`,
  async () => [{ kind: 'codex', command: 'codex', available: true }],
  createWorkJournal(storage, owner)
);
controller.activate();
await controller.startGoal(input);
if (phase === 'recover') {
  await controller.refresh();
  const unresolvedKey = controller.getSnapshot().pending?.requestKey;
  visible = true;
  await controller.refresh();
  console.log(
    JSON.stringify({
      posts,
      lookupActors,
      lookupKeys,
      unresolvedKey,
      recoveredTaskId: controller.getSnapshot().detail?.task.id,
      pending: controller.getSnapshot().pending,
      keysGenerated,
    })
  );
} else {
  console.log(
    JSON.stringify({
      posts,
      pendingKey: controller.getSnapshot().pending?.requestKey,
      keysGenerated,
    })
  );
}
controller.deactivate();
