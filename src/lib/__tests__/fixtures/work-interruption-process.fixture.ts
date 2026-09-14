import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkJournal } from '../../work-journal';
import { createWorkApi } from '../../work-api';
import { WorkController } from '../../work-controller';

const phase = process.argv[2],
  directory = process.argv[3];
if (!directory || !['write', 'recover'].includes(phase)) throw new Error('Invalid fixture');
const path = join(directory, 'journal.json');
const journal = createWorkJournal(
  {
    read: async () => {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
          return null;
        throw error;
      }
    },
    write: (value) => writeFile(path, value, { mode: 0o600 }),
  },
  { pairingFingerprint: 'a'.repeat(64), sessionId: 'session' }
);
const taskId = '00000000-0000-4000-8000-000000000001';
const attemptId = '00000000-0000-4000-8000-000000000002';
const operationId = '00000000-0000-4000-8000-000000000003';
if (phase === 'write') {
  await journal.save({
    kind: 'deliver',
    requestKey: 'delivery-original',
    taskId,
    state: 'unconfirmed',
  });
  await journal.saveInterruption!({
    kind: 'interrupt',
    requestKey: 'interrupt-original',
    taskId,
    attemptId,
    expectedInstanceId: 'launch',
    expectedNativeOwnerEpoch: 'epoch',
    state: 'unconfirmed',
  });
  console.log(
    JSON.stringify({
      primary: (await journal.load())?.requestKey,
      interruption: (await journal.loadInterruption!())?.requestKey,
    })
  );
} else {
  let posts = 0,
    keys = 0,
    visible = false;
  const gets: string[] = [];
  const api = createWorkApi(
    {
      serverId: 'gateway',
      label: 'Gateway',
      url: 'https://example.invalid',
      token: 'never-stored',
      pairedAt: 1,
    },
    'session',
    async (_record, requestPath, request) => {
      if (request.method !== 'GET') {
        posts++;
        throw new Error('Forbidden POST');
      }
      gets.push(requestPath);
      if (!visible)
        return { status: 404, body: { error: { code: 'not_found', message: 'Not yet visible' } } };
      return {
        status: 200,
        body: {
          kind: 'interrupt_attempt',
          value: {
            id: operationId,
            task_id: taskId,
            attempt_id: attemptId,
            kind: 'interrupt_attempt',
            state: 'acknowledged',
            resources: {
              instance_id: 'launch',
              pane_id: 'pane',
              target: 'target',
              worktree_path: '/repo',
            },
            failure_code: null,
            created_at_ms: 1,
            updated_at_ms: 1,
            interruption_receipt: {
              operation_id: operationId,
              launch_id: 'launch',
              owner_epoch: 'epoch',
              receipt_id: 'native-receipt',
              key: 'Escape',
              bytes_written: 1,
              input_disposition: 'written',
            },
          },
        },
      };
    }
  );
  const controller = new WorkController(
    api,
    async () => ({ connected: true, records: true, execution: true, interruption: true }),
    () => `forbidden-${++keys}`,
    undefined,
    journal
  );
  controller.activate();
  await controller.checkInterruptionStatus();
  await controller.interruptAttempt(attemptId);
  const missing = controller.getSnapshot().interruption.pending?.requestKey;
  visible = true;
  await controller.checkInterruptionStatus();
  console.log(
    JSON.stringify({
      posts,
      keys,
      gets,
      missing,
      primary: await journal.load(),
      interruption: await journal.loadInterruption!(),
    })
  );
}
