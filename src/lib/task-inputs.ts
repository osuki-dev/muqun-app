import { workPairingFingerprint } from './work-controller-cache';
import type { GatewayRecord } from './gateway-storage';
import { utf8Bytes } from './multipart';
import { MAX_ATTACHMENTS_PER_PICK, MAX_UPLOAD_BYTES, type PickedFile } from './attachment-queue';

export const TASK_INPUT_CAPABILITY = 'work_inputs_v1';
export type TaskInputScope = {
  sessionId: string;
  project: string;
  draftId: string;
  taskId?: string;
  attemptId?: string;
};
export type TaskInputReceipt = {
  input_id: string;
  session_id: string;
  repo_path: string;
  name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at_ms: number;
  expires_at_ms: number;
};
export type TaskInputRef = {
  input_id: string;
  caption: string;
  use: 'reference-only' | 'may-include';
};
export type TaskInputContext = { isCurrent: () => boolean; signal?: AbortSignal };
export type TaskInputUpload = (
  record: GatewayRecord,
  scope: TaskInputScope,
  requestKey: string,
  file: PickedFile,
  context: TaskInputContext
) => Promise<TaskInputReceipt>;

const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && utf8Bytes(v).length <= max && !v.includes('\0');

export function taskInputScopeKey(scope: TaskInputScope): string {
  if (
    !text(scope.sessionId, 256) ||
    !text(scope.project, 4096) ||
    !scope.project.startsWith('/') ||
    !text(scope.draftId, 256) ||
    (scope.taskId !== undefined && !id(scope.taskId)) ||
    (scope.attemptId !== undefined && !id(scope.attemptId))
  )
    throw new Error('Invalid input destination.');
  return JSON.stringify([
    scope.sessionId,
    scope.project,
    scope.draftId,
    scope.taskId ?? null,
    scope.attemptId ?? null,
  ]);
}

export function taskInputPath(sessionId: string): string {
  if (!text(sessionId, 256)) throw new Error('Invalid input session.');
  return `/api/sessions/${encodeURIComponent(sessionId)}/work/inputs`;
}
export function taskInputReceiptPath(sessionId: string, requestKey: string): string {
  if (!text(requestKey, 128)) throw new Error('Invalid upload request key.');
  return (
    taskInputPath(sessionId).replace(/inputs$/, 'input-receipts') +
    `?request_key=${encodeURIComponent(requestKey)}`
  );
}

/** A canonical reply cannot quietly authorize a different project selected during upload. */
export function parseTaskInputReceipt(value: unknown, scope: TaskInputScope): TaskInputReceipt {
  taskInputScopeKey(scope);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid input receipt.');
  const v = value as Record<string, unknown>;
  if (
    !id(v.input_id) ||
    v.session_id !== scope.sessionId ||
    !text(v.repo_path, 4096) ||
    !v.repo_path.startsWith('/') ||
    !text(v.name, 480) ||
    [...v.name].length > 120 ||
    !text(v.mime, 128) ||
    !Number.isSafeInteger(v.size_bytes) ||
    (v.size_bytes as number) <= 0 ||
    (v.size_bytes as number) > MAX_UPLOAD_BYTES ||
    typeof v.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    !Number.isSafeInteger(v.created_at_ms) ||
    (v.created_at_ms as number) < 0 ||
    !Number.isSafeInteger(v.expires_at_ms) ||
    (v.expires_at_ms as number) <= (v.created_at_ms as number)
  )
    throw new Error('Invalid or changed input receipt.');
  const receipt: TaskInputReceipt = {
    input_id: v.input_id,
    session_id: scope.sessionId,
    repo_path: v.repo_path,
    name: v.name,
    mime: v.mime,
    size_bytes: v.size_bytes as number,
    sha256: v.sha256,
    created_at_ms: v.created_at_ms as number,
    expires_at_ms: v.expires_at_ms as number,
  };
  if (receipt.repo_path !== scope.project)
    throw new TaskInputProjectResolutionError(scope.project, receipt);
  return receipt;
}

export function taskInputRefs(
  receipts: readonly TaskInputReceipt[],
  scope: TaskInputScope,
  now = Date.now()
): TaskInputRef[] {
  if (receipts.length > MAX_ATTACHMENTS_PER_PICK) throw new Error('Too many input files.');
  const seen = new Set<string>();
  return receipts.map((raw) => {
    const receipt = parseTaskInputReceipt(raw, scope);
    if (receipt.expires_at_ms <= now || seen.has(receipt.input_id))
      throw new Error('Input expired or duplicated.');
    seen.add(receipt.input_id);
    return { input_id: receipt.input_id, caption: '', use: 'reference-only' };
  });
}

/** Scope lifetime is independent of React and can be invalidated at destination changes. */
export class TaskInputOwnership {
  private generation = 0;
  private key = '';
  update(scope: TaskInputScope | null): void {
    const key = scope ? taskInputScopeKey(scope) : '';
    if (key !== this.key) {
      this.key = key;
      this.generation += 1;
    }
  }
  invalidate(): void {
    this.generation += 1;
  }
  capture(scope: TaskInputScope): () => boolean {
    const key = taskInputScopeKey(scope);
    const generation = this.generation;
    return () => this.key === key && this.generation === generation;
  }
}

/** Requires explicit project selection; the receipt is never silently adopted. */
export class TaskInputProjectResolutionError extends Error {
  constructor(
    readonly requestedProject: string,
    readonly receipt: TaskInputReceipt
  ) {
    super('Select the resolved project and attach the file again.');
    this.name = 'TaskInputProjectResolutionError';
  }
}
export type TaskInputEntrySnapshot = {
  id: string;
  revision: number;
  uploadVersion: number;
  localUri: string;
  caption: string;
  use: 'reference-only' | 'may-include';
};
export function captureTaskInputEntries(
  entries: readonly import('./attachment-queue').PendingAttachment[]
): TaskInputEntrySnapshot[] {
  return entries.map((entry) => ({
    id: entry.id,
    revision: entry.revision ?? 0,
    uploadVersion: entry.uploadVersion ?? 0,
    localUri: entry.localUri,
    caption: entry.caption ?? '',
    use: entry.use ?? 'reference-only',
  }));
}
export function sameTaskInputVersion(
  snapshot: TaskInputEntrySnapshot,
  entry: import('./attachment-queue').PendingAttachment
): boolean {
  return (
    snapshot.id === entry.id &&
    snapshot.revision === (entry.revision ?? 0) &&
    snapshot.uploadVersion === (entry.uploadVersion ?? 0) &&
    snapshot.localUri === entry.localUri &&
    snapshot.caption === (entry.caption ?? '') &&
    snapshot.use === (entry.use ?? 'reference-only')
  );
}
export type TaskInputReceiptReader = (
  record: GatewayRecord,
  scope: TaskInputScope,
  key: string,
  context: TaskInputContext
) => Promise<TaskInputReceipt | null>;

/** An explicit retry first reconciles the prior upload key. It never sends an instruction. */
export class TaskInputUploadJournal {
  private entries = new Map<string, { key: string; receipt?: TaskInputReceipt }>();
  constructor(
    private newKey: () => string,
    private upload: TaskInputUpload,
    private read: TaskInputReceiptReader,
    private now: () => number = Date.now
  ) {}
  clear(): void {
    this.entries.clear();
  }
  remove(id: string): void {
    this.entries.delete(id);
  }
  receipt(id: string): TaskInputReceipt | undefined {
    return this.entries.get(id)?.receipt;
  }
  renewExpired(id: string): boolean {
    const receipt = this.entries.get(id)?.receipt;
    if (!receipt || receipt.expires_at_ms > this.now()) return false;
    this.entries.delete(id);
    return true;
  }
  async run(
    id: string,
    record: GatewayRecord,
    scope: TaskInputScope,
    file: PickedFile,
    context: TaskInputContext
  ): Promise<TaskInputReceipt> {
    const existing = this.entries.get(id);
    const state = existing ?? { key: this.newKey() };
    this.entries.set(id, state);
    const current = () =>
      context.isCurrent() && !context.signal?.aborted && this.entries.get(id) === state;
    if (!current()) throw new Error('Input destination changed.');
    try {
      let receipt = existing
        ? await this.read(record, scope, state.key, { ...context, isCurrent: current })
        : null;
      if (!current()) throw new Error('Input destination changed.');
      if (!receipt)
        receipt = await this.upload(record, scope, state.key, file, {
          ...context,
          isCurrent: current,
        });
      if (!current()) throw new Error('Input destination changed.');
      state.receipt = parseTaskInputReceipt(receipt, scope);
      if (receipt.expires_at_ms <= this.now())
        throw new Error('Input expired. Re-upload this file explicitly.');
      return state.receipt;
    } catch (error) {
      if (current() && error instanceof TaskInputProjectResolutionError)
        state.receipt = error.receipt;
      throw error;
    }
  }
}

/** Compare the existing work ownership fields, never display metadata. No raw key is retained. */
export function sameTaskInputPairing(a: GatewayRecord | null, b: GatewayRecord | null): boolean {
  if (!a || !b) return a === b;
  return (
    workPairingFingerprint(a, (value) => value) === workPairingFingerprint(b, (value) => value)
  );
}
