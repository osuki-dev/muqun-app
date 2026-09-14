import { utf8Bytes } from './multipart';

export interface PendingWorkIntent {
  requestKey: string;
  taskId: string | null;
  kind:
    | 'create'
    | 'start'
    | 'deliver'
    | 'review'
    | 'pause'
    | 'reconcile'
    | 'configure'
    | 'dependencies';
  attemptId?: string;
  expectedInstanceId?: string | null;
  expectedNativeOwnerEpoch?: string | null;
  state: 'submitting' | 'unconfirmed' | 'acknowledged';
  operationId?: string;
}
export interface WorkJournalPort {
  load(): Promise<PendingWorkIntent | null>;
  save(pending: PendingWorkIntent | null): Promise<void>;
  loadInterruption?(): Promise<PendingWorkInterruption | null>;
  saveInterruption?(pending: PendingWorkInterruption | null): Promise<void>;
}
export type PendingWorkInterruption = Omit<
  PendingWorkIntent,
  'kind' | 'taskId' | 'attemptId' | 'expectedInstanceId' | 'expectedNativeOwnerEpoch'
> & {
  kind: 'interrupt';
  taskId: string;
  attemptId: string;
  expectedInstanceId: string;
  expectedNativeOwnerEpoch: string;
};
export interface WorkJournalScope {
  pairingFingerprint: string;
  sessionId: string;
}
export interface WorkJournalStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}
interface JournalRecord extends WorkJournalScope {
  pending: PendingWorkIntent | null;
  interruption: PendingWorkInterruption | null;
}
const MAX_RECORDS = 32;
const MAX_BYTES = 32 * 1024;
const queues = new WeakMap<WorkJournalStorage, Promise<void>>();

export class WorkJournalError extends Error {
  constructor(readonly code: 'invalid_journal' | 'journal_full' | 'storage_unavailable') {
    super('Pending work could not be safely stored. No new request may be sent.');
    this.name = 'WorkJournalError';
  }
}
function invalid(): never {
  throw new WorkJournalError('invalid_journal');
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return invalid();
  return record;
}
function identifier(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    utf8Bytes(value).length > maximum ||
    value.includes('\0')
  )
    return invalid();
  return value;
}
function scope(value: unknown): WorkJournalScope {
  const record = object(value, ['pairingFingerprint', 'sessionId']);
  const fingerprint = identifier(record.pairingFingerprint, 64);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) return invalid();
  return { pairingFingerprint: fingerprint, sessionId: identifier(record.sessionId) };
}
function pending(value: unknown): PendingWorkIntent {
  const record = object(value, [
    'requestKey',
    'taskId',
    'kind',
    'state',
    'operationId',
    'attemptId',
    'expectedInstanceId',
    'expectedNativeOwnerEpoch',
  ]);
  const kind = record.kind;
  const state = record.state;
  if (
    (kind !== 'create' &&
      kind !== 'start' &&
      kind !== 'deliver' &&
      kind !== 'review' &&
      kind !== 'pause' &&
      kind !== 'configure' &&
      kind !== 'dependencies' &&
      kind !== 'reconcile') ||
    (state !== 'submitting' && state !== 'unconfirmed' && state !== 'acknowledged')
  )
    return invalid();
  const opaque = (value: unknown) => {
    const id = identifier(value);
    if (/[\u0000-\u001f\u007f-\u009f]/.test(id)) invalid();
    return id;
  };
  const hasIdentity = ['attemptId', 'expectedInstanceId', 'expectedNativeOwnerEpoch'].some(
    (key) => key in record
  );
  if (kind !== 'reconcile' && kind !== 'deliver' && kind !== 'configure' && hasIdentity) invalid();
  if ((kind === 'configure' || kind === 'dependencies') && record.taskId === null) invalid();
  if ((kind === 'reconcile' || hasIdentity) && record.taskId === null) invalid();
  return {
    requestKey: identifier(record.requestKey, 128),
    taskId: record.taskId === null ? null : identifier(record.taskId),
    kind,
    state,
    ...(kind === 'reconcile' || hasIdentity
      ? {
          attemptId: identifier(record.attemptId),
          expectedInstanceId:
            record.expectedInstanceId === null ? null : opaque(record.expectedInstanceId),
          expectedNativeOwnerEpoch:
            record.expectedNativeOwnerEpoch === null
              ? null
              : opaque(record.expectedNativeOwnerEpoch),
        }
      : {}),
    ...(record.operationId === undefined ? {} : { operationId: identifier(record.operationId) }),
  };
}
function matches(left: WorkJournalScope, right: WorkJournalScope): boolean {
  return left.pairingFingerprint === right.pairingFingerprint && left.sessionId === right.sessionId;
}
function interruption(value: unknown): PendingWorkInterruption {
  const raw = object(value, [
    'requestKey',
    'taskId',
    'kind',
    'state',
    'operationId',
    'attemptId',
    'expectedInstanceId',
    'expectedNativeOwnerEpoch',
  ]);
  if (
    raw.kind !== 'interrupt' ||
    raw.expectedInstanceId === null ||
    raw.expectedNativeOwnerEpoch === null
  )
    invalid();
  const parsed = pending({ ...raw, kind: 'reconcile' });
  return {
    ...parsed,
    kind: 'interrupt',
    taskId: identifier(parsed.taskId),
    attemptId: identifier(parsed.attemptId),
    expectedInstanceId: identifier(parsed.expectedInstanceId),
    expectedNativeOwnerEpoch: identifier(parsed.expectedNativeOwnerEpoch),
  };
}
function decode(raw: string | null): JournalRecord[] {
  if (raw === null) return [];
  if (raw.length > MAX_BYTES || utf8Bytes(raw).length > MAX_BYTES) return invalid();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const envelope = object(value, ['version', 'records']);
  if (
    (envelope.version !== 1 && envelope.version !== 2) ||
    !Array.isArray(envelope.records) ||
    envelope.records.length > MAX_RECORDS
  )
    return invalid();
  const records: JournalRecord[] = [];
  for (const value of envelope.records) {
    const record = object(
      value,
      envelope.version === 1
        ? ['pairingFingerprint', 'sessionId', 'pending']
        : ['pairingFingerprint', 'sessionId', 'pending', 'interruption']
    );
    const owner = scope({
      pairingFingerprint: record.pairingFingerprint,
      sessionId: record.sessionId,
    });
    if (records.some((existing) => matches(existing, owner))) return invalid();
    const primary =
      envelope.version === 2 && record.pending === null ? null : pending(record.pending);
    const control =
      envelope.version === 1 || record.interruption === null
        ? null
        : interruption(record.interruption);
    if (!primary && !control) invalid();
    records.push({ ...owner, pending: primary, interruption: control });
  }
  return records;
}
async function serialized<T>(storage: WorkJournalStorage, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(storage) ?? Promise.resolve();
  const result = previous.then(action);
  queues.set(
    storage,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  try {
    return await result;
  } catch (error) {
    if (error instanceof WorkJournalError) throw error;
    throw new WorkJournalError('storage_unavailable');
  }
}

/** Only committed metadata is persisted. Unresolved records are never evicted or aged out. */
export function createWorkJournal(
  storage: WorkJournalStorage,
  owner: WorkJournalScope
): WorkJournalPort {
  const captured = scope(owner);
  const saveLane = (
    lane: 'pending' | 'interruption',
    value: PendingWorkIntent | PendingWorkInterruption | null
  ) =>
    serialized(storage, async () => {
      const next =
        value === null ? null : lane === 'pending' ? pending(value) : interruption(value);
      const records = decode(await storage.read());
      const index = records.findIndex((record) => matches(record, captured));
      const record: JournalRecord =
        index < 0 ? { ...captured, pending: null, interruption: null } : records[index];
      if (
        lane === 'interruption' &&
        record.interruption &&
        next &&
        record.interruption.requestKey !== next.requestKey
      )
        throw new WorkJournalError('journal_full');
      const updated = { ...record, [lane]: next } as JournalRecord;
      if (!updated.pending && !updated.interruption) {
        if (index < 0) return;
        records.splice(index, 1);
      } else if (index < 0) {
        if (records.length >= MAX_RECORDS) throw new WorkJournalError('journal_full');
        records.push(updated);
      } else records[index] = updated;
      const encoded = JSON.stringify({ version: 2, records });
      if (utf8Bytes(encoded).length > MAX_BYTES) throw new WorkJournalError('journal_full');
      await storage.write(encoded);
      if ((await storage.read()) !== encoded) throw new WorkJournalError('storage_unavailable');
    });
  return {
    load: () =>
      serialized(storage, async () => {
        const record = decode(await storage.read()).find((record) => matches(record, captured));
        return record?.pending ? { ...record.pending } : null;
      }),
    save: (value) => saveLane('pending', value),
    loadInterruption: () =>
      serialized(storage, async () => {
        const record = decode(await storage.read()).find((record) => matches(record, captured));
        return record?.interruption ? { ...record.interruption } : null;
      }),
    saveInterruption: (value) => saveLane('interruption', value),
  };
}
