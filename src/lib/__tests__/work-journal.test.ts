import { expect, test } from 'bun:test';
import {
  createWorkJournal,
  type PendingWorkIntent,
  type WorkJournalStorage,
} from '../work-journal';

const owner = { pairingFingerprint: 'a'.repeat(64), sessionId: 'session' };
const intent: PendingWorkIntent = {
  requestKey: 'original-key',
  taskId: null,
  kind: 'create',
  state: 'submitting',
};
test('reconciliation journals require exact nullable identity fields and reject them on ordinary input', async () => {
  const journal = createWorkJournal(disk(), owner);
  const reconciliation: PendingWorkIntent = {
    ...intent,
    taskId: 'task',
    kind: 'reconcile',
    attemptId: 'attempt',
    expectedInstanceId: null,
    expectedNativeOwnerEpoch: null,
  };
  await journal.save(reconciliation);
  expect(await journal.load()).toEqual(reconciliation);
  await expect(
    journal.save({ ...reconciliation, expectedNativeOwnerEpoch: undefined })
  ).rejects.toThrow();
  await expect(
    journal.save({ ...reconciliation, expectedNativeOwnerEpoch: 'epoch\nforged' })
  ).rejects.toThrow();
  await expect(journal.save({ ...intent, attemptId: 'foreign' })).rejects.toThrow();
  expect(await journal.load()).toEqual(reconciliation);
});
function disk(initial: string | null = null) {
  let stored = initial;
  return {
    read: async () => stored,
    write: async (value: string) => {
      stored = value;
    },
    raw: () => stored,
  };
}

async function expectFailure(action: Promise<unknown>, code: string) {
  try {
    await action;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('Expected journal refusal');
}

test('a reconstructed journal preserves the same pending key and known stage without prompts', async () => {
  const storage = disk();
  await createWorkJournal(storage, owner).save(intent);
  const reconstructed = createWorkJournal(storage, owner);
  expect(await reconstructed.load()).toEqual(intent);
  await reconstructed.save({ ...intent, taskId: 'task-id', state: 'acknowledged' });
  expect(await createWorkJournal(storage, owner).load()).toMatchObject({
    requestKey: 'original-key',
    taskId: 'task-id',
    state: 'acknowledged',
  });
  expect(JSON.parse(storage.raw() ?? 'null').records[0].pending).toEqual({
    ...intent,
    taskId: 'task-id',
    state: 'acknowledged',
  });
  await reconstructed.save(null);
  expect(await createWorkJournal(storage, owner).load()).toBe(null);
});

test('pairing and session isolation preserves old unresolved work and never widens scope', async () => {
  const storage = disk();
  await createWorkJournal(storage, owner).save(intent);
  const replacement = createWorkJournal(storage, { ...owner, pairingFingerprint: 'b'.repeat(64) });
  expect(await replacement.load()).toBe(null);
  const otherSession = createWorkJournal(storage, { ...owner, sessionId: 'other' });
  await Promise.all([
    replacement.save({ ...intent, requestKey: 'replacement-key' }),
    otherSession.save({ ...intent, requestKey: 'other-key' }),
  ]);
  expect((await createWorkJournal(storage, owner).load())?.requestKey).toBe('original-key');
  expect((await replacement.load())?.requestKey).toBe('replacement-key');
  expect((await otherSession.load())?.requestKey).toBe('other-key');
});

test('storage rejection or failed readback never reports permission to dispatch', async () => {
  const failing: WorkJournalStorage = {
    read: async () => null,
    write: async () => {
      throw new Error('Native write unavailable');
    },
  };
  await expectFailure(createWorkJournal(failing, owner).save(intent), 'storage_unavailable');
  const lost: WorkJournalStorage = { read: async () => null, write: async () => undefined };
  await expectFailure(createWorkJournal(lost, owner).save(intent), 'storage_unavailable');
});

test('malformed or future journals and extra sensitive fields fail closed without overwriting', async () => {
  for (const raw of [
    'broken',
    JSON.stringify({ version: 3, records: [] }),
    JSON.stringify({
      version: 1,
      records: [{ ...owner, pending: { ...intent, prompt: 'private instruction' } }],
    }),
  ]) {
    const storage = disk(raw);
    await expectFailure(createWorkJournal(storage, owner).load(), 'invalid_journal');
    await expectFailure(createWorkJournal(storage, owner).save(intent), 'invalid_journal');
    expect(storage.raw()).toBe(raw);
  }
  const storage = disk();
  const invalidIntent = { ...intent, token: 'credential' };
  await expectFailure(createWorkJournal(storage, owner).save(invalidIntent), 'invalid_journal');
  expect(storage.raw()).toBe(null);
});

test('v1 migrates losslessly to independent bounded interruption and delivery lanes', async () => {
  const primary = {
    ...intent,
    kind: 'deliver' as const,
    taskId: 'task',
    state: 'unconfirmed' as const,
  };
  const storage = disk(JSON.stringify({ version: 1, records: [{ ...owner, pending: primary }] }));
  const journal = createWorkJournal(storage, owner);
  expect(await journal.load()).toEqual(primary);
  expect(await journal.loadInterruption!()).toBe(null);
  expect(JSON.parse(storage.raw()!).version).toBe(1);
  const control = {
    requestKey: 'interrupt-key',
    kind: 'interrupt' as const,
    taskId: 'task',
    attemptId: 'attempt',
    expectedInstanceId: 'launch',
    expectedNativeOwnerEpoch: 'epoch',
    state: 'unconfirmed' as const,
  };
  await journal.saveInterruption!(control);
  expect(JSON.parse(storage.raw()!).version).toBe(2);
  const restored = createWorkJournal(storage, owner);
  expect(await restored.load()).toEqual(primary);
  expect(await restored.loadInterruption!()).toEqual(control);
  await restored.save(null);
  expect(await restored.loadInterruption!()).toEqual(control);
  await restored.save(primary);
  await restored.saveInterruption!(null);
  expect(await restored.load()).toEqual(primary);
  await expect(
    restored.saveInterruption!({ ...control, expectedNativeOwnerEpoch: '' })
  ).rejects.toThrow();
  await expect(
    restored.saveInterruption!({ ...control, expectedInstanceId: 'launch\nother' })
  ).rejects.toThrow();
  expect(await restored.load()).toEqual(primary);
});

test('capacity refuses new pending records without evicting unresolved intents', async () => {
  const storage = disk();
  for (let index = 0; index < 32; index++)
    await createWorkJournal(storage, { ...owner, sessionId: `session-${index}` }).save(intent);
  const original = storage.raw();
  await expectFailure(
    createWorkJournal(storage, { ...owner, sessionId: 'overflow' }).save(intent),
    'journal_full'
  );
  expect(storage.raw()).toBe(original);
  expect(
    (await createWorkJournal(storage, { ...owner, sessionId: 'session-0' }).load())?.requestKey
  ).toBe('original-key');
});
