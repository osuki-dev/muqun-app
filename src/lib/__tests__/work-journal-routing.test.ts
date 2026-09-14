import { expect, test } from 'bun:test';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import { createWorkJournal, type PendingWorkIntent } from '../work-journal';
import { createWorkJournalRouter } from '../work-journal-routing';

const scope = { pairingFingerprint: 'a'.repeat(64), sessionId: 'demo' };
const pending: PendingWorkIntent = {
  requestKey: 'uncertain-demo',
  taskId: null,
  kind: 'create',
  state: 'unconfirmed',
};

test('explicit demo retains pending navigation state but resets with its fixture process', async () => {
  const rejectSecureStore = () => {
    throw new Error('Demo must not touch real secure storage');
  };
  const router = createWorkJournalRouter(rejectSecureStore);
  const demo = { serverId: DEMO_PAIRING_SERVER_ID };
  await router(demo, scope).save(pending);
  expect(await router(demo, scope).load()).toEqual(pending);
  const nextProcess = createWorkJournalRouter(rejectSecureStore);
  expect(await nextProcess(demo, scope).load()).toBe(null);
});

test('every real pairing remains durable even when display metadata resembles the demo', async () => {
  let persisted: string | null = null;
  const storage = {
    read: async () => persisted,
    write: async (value: string) => {
      persisted = value;
    },
  };
  const secure = (owner: typeof scope) => createWorkJournal(storage, owner);
  const record = { serverId: 'real-paired-server', label: 'Demo', url: 'https://demo.invalid' };
  await createWorkJournalRouter(secure)(record, scope).save(pending);
  expect(await createWorkJournalRouter(secure)(record, scope).load()).toEqual(pending);
});

test('a real storage failure never falls back to demo memory', async () => {
  let writes = 0;
  const router = createWorkJournalRouter((owner) =>
    createWorkJournal(
      {
        read: async () => null,
        write: async () => {
          writes++;
          throw new Error('Native secure store failed');
        },
      },
      owner
    )
  );
  await expect(router({ serverId: 'paired' }, scope).save(pending)).rejects.toThrow(
    'Pending work could not be safely stored'
  );
  expect(writes).toBe(1);
  expect(await router({ serverId: DEMO_PAIRING_SERVER_ID }, scope).load()).toBe(null);
});
