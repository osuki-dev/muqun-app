import type { GatewayRecord } from './gateway-storage';
import { assertDeliveryCurrent } from './bound-delivery';
import { utf8Bytes } from './multipart';
import type { TaskInputRef } from './task-inputs';
import { parseWorkTaskSummaryPage } from './work-summaries';
import {
  parseWorkDelegationPolicy,
  parseWorkDelegationState,
  type WorkDelegationState,
  type WorkDelegationConfig,
} from './work-delegation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failures = [
  'invalid_input',
  'not_found',
  'scope_mismatch',
  'revision_conflict',
  'request_key_conflict',
  'capability_unavailable',
  'instance_changed',
  'not_ready',
  'approval_required',
  'delivery_unconfirmed',
  'artifact_changed',
  'artifact_missing',
  'resource_limit',
  'storage_unavailable',
  'input_expired',
] as const;
const states = ['prepared', 'submitting', 'acknowledged', 'refused', 'unconfirmed'] as const;
const kinds = [
  'create_task',
  'start_attempt',
  'deliver_prompt',
  'submit_result',
  'review_result',
  'pause_task',
  'reconcile_attempt',
  'interrupt_attempt',
  'configure_delegation',
  'set_dependencies',
] as const;
export type WorkFailureCode = (typeof failures)[number];
export type WorkPolicy = { allowed_agents: string[]; max_workers: number };
export type WorkCreateTask = {
  input_refs?: TaskInputRef[];
  repo_path: string;
  title: string;
  brief: string;
  parent_task_id: string | null;
  policy: WorkPolicy;
};
export type WorkFrozenInput = TaskInputRef & {
  name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
};
export type WorkTask = Omit<WorkCreateTask, 'input_refs'> & {
  delegation?: WorkDelegationState;
  dependencies?: WorkDependency[];
  input_refs?: WorkFrozenInput[];
  id: string;
  session_id: string;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
  paused: boolean;
};
export type WorkDependency = { prerequisite_task_id: string; submission_id: string | null };
export type WorkDependencyIntent = {
  serverId: string;
  sessionId: string;
  taskId: string;
  expected_revision: number;
  dependencies: WorkDependency[];
};
export type WorkBinding = {
  instance_id: string | null;
  target: string | null;
  pane_id: string | null;
  worktree_path: string | null;
  workspace_id?: string | null;
  tab_id?: string | null;
};
export type WorkAttempt = WorkBinding & {
  lifecycle?: WorkLifecycle;
  id: string;
  task_id: string;
  agent_kind: string;
  role: 'lead' | 'worker';
  created_at_ms: number;
};
export type WorkRelease = {
  reason: 'startup_not_dispatched' | 'startup_refused_without_process' | 'owned_process_exited';
  evidence:
    | { kind: 'gateway_dispatch_fence'; start_operation_id: string }
    | {
        kind: 'native_start_refusal';
        start_operation_id: string;
        native_owner_epoch: string;
        native_receipt_id: string;
      }
    | {
        kind: 'native_exit_tombstone';
        instance_id: string;
        native_owner_epoch: string;
        native_receipt_id: string;
      };
  reconciliation_operation_id: string;
  released_at_ms: number;
};
export type WorkLifecycle = {
  launch_phase: 'not_dispatched' | 'dispatch_claimed' | 'launch_confirmed' | 'legacy_unknown';
  reservation: 'reserved' | 'released';
  native_owner_epoch: string | null;
  release: WorkRelease | null;
};
export type WorkReconciliation = {
  operation_id: string;
  attempt_id: string;
  observation: 'not_started' | 'live' | 'exited' | 'unknown' | 'already_released';
  reservation: 'reserved' | 'released';
  release: WorkRelease | null;
  task_revision: number;
};
export type WorkReconcileInput = {
  expected_revision: number;
  expected_instance_id: string | null;
  expected_native_owner_epoch: string | null;
};
export type WorkOperation = {
  interruption_receipt?: WorkInterruptionReceipt | null;
  input_refs?: WorkFrozenInput[];
  id: string;
  task_id: string;
  attempt_id: string | null;
  kind: (typeof kinds)[number];
  state: (typeof states)[number];
  resources: WorkBinding;
  failure_code: WorkFailureCode | null;
  created_at_ms: number;
  updated_at_ms: number;
};
export type WorkInterruptionReceipt = {
  operation_id: string;
  launch_id: string;
  owner_epoch: string;
  receipt_id: string;
  key: 'Escape';
  bytes_written: 1;
  input_disposition: 'written';
};
export type WorkArtifact = { path: string; sha256: string; size_bytes: number };
export type WorkResultInput = {
  attempt_id: string;
  summary: string;
  artifacts: WorkArtifact[];
  evidence: string[];
};
export type WorkResult = WorkResultInput & { id: string; task_id: string; created_at_ms: number };
export type WorkReviewInput = {
  submission_id: string;
  decision: 'accepted' | 'changes_requested';
  message: string | null;
};
export type WorkReview = WorkReviewInput & {
  id: string;
  task_id: string;
  actor_id: string;
  created_at_ms: number;
};
export type WorkRecordKind = 'attempt' | 'operation' | 'result' | 'review';
export type WorkPage = {
  snapshot_revision: number;
  after_id: string | null;
  next_after_id: string | null;
  has_more: boolean;
};
export type WorkRecordTypes = {
  attempt: WorkAttempt;
  operation: WorkOperation;
  result: WorkResult;
  review: WorkReview;
};
export type WorkRecordPage<K extends WorkRecordKind> = {
  items: WorkRecordTypes[K][];
  page: WorkPage;
};
export type WorkDetail = {
  task: WorkTask;
  attempts: WorkAttempt[];
  operations: WorkOperation[];
  results: WorkResult[];
  reviews: WorkReview[];
  cursor: number;
  pages?: { attempts: WorkPage; operations: WorkPage; results: WorkPage; reviews: WorkPage };
};
export type WorkChange = {
  cursor: number;
  task_id: string;
  revision: number;
  kind: string;
  entity_id: string;
};
export type WorkChangePage = { changes: WorkChange[]; cursor: number; reset_required: boolean };
export type WorkMutation<T> = { value: T; replayed: boolean };
export type WorkReceiptKind =
  | 'create_task'
  | 'start_attempt'
  | 'deliver_prompt'
  | 'review_result'
  | 'pause_task'
  | 'reconcile_attempt'
  | 'interrupt_attempt'
  | 'configure_delegation'
  | 'set_dependencies';
export type WorkReceipt =
  | {
      kind: 'create_task' | 'pause_task' | 'configure_delegation' | 'set_dependencies';
      value: WorkTask;
    }
  | { kind: 'start_attempt' | 'deliver_prompt' | 'interrupt_attempt'; value: WorkOperation }
  | { kind: 'review_result'; value: WorkReview }
  | {
      kind: 'reconcile_attempt';
      value:
        | { receipt_type: 'operation'; operation: WorkOperation }
        | { receipt_type: 'reconciliation'; receipt: WorkReconciliation };
    };
export type WorkRequestContext = { isCurrent: () => boolean; signal?: AbortSignal };
export type WorkTransport = (
  record: GatewayRecord,
  path: string,
  request: WorkRequestContext & { method: 'GET' | 'POST'; body?: string }
) => Promise<{ status: number; body: unknown }>;

/** No raw server message or prompt is interpolated into an error or log. */
export class WorkApiError extends Error {
  constructor(
    readonly outcome: 'refused' | 'unconfirmed' | 'invalid_response',
    readonly code: string,
    readonly requestKey?: string,
    readonly status?: number
  ) {
    super(
      outcome === 'unconfirmed'
        ? 'The operation is not confirmed. Check its status before sending again.'
        : outcome === 'invalid_response'
          ? 'The Gateway returned an invalid task response.'
          : 'The Gateway refused this operation.'
    );
    this.name = 'WorkApiError';
  }
}
function invalid(): never {
  throw new WorkApiError('invalid_response', 'invalid_response');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 4096, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    utf8Bytes(value).length > max ||
    (!empty && !value.trim())
  )
    return invalid();
  return value;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    return invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}
function uuid(value: unknown): string {
  const id = string(value, 36);
  if (!UUID.test(id)) return invalid();
  return id;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  for (const candidate of values) if (value === candidate) return candidate;
  return invalid();
}
function array<T>(value: unknown, parse: (value: unknown) => T, max = 10000): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map(parse);
}
function matches(actual: string, expected?: string): string {
  if (expected !== undefined && actual !== expected) return invalid();
  return actual;
}
function unique(items: { id: string }[]): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
}
function policy(value: unknown): WorkPolicy {
  const raw = object(value);
  const allowed_agents = array(raw.allowed_agents, (item) => string(item, 64), 32);
  const max_workers = integer(raw.max_workers, 16);
  if (!allowed_agents.length) return invalid();
  return { allowed_agents, max_workers };
}
function inputRefs(value: unknown): TaskInputRef[] {
  const refs = array(
    value,
    (item) => {
      const raw = object(item);
      return {
        input_id: uuid(raw.input_id),
        caption: raw.caption === undefined ? '' : string(raw.caption, 4096, true),
        use:
          raw.use === undefined
            ? ('reference-only' as const)
            : enumeration(raw.use, ['reference-only', 'may-include']),
      };
    },
    9
  );
  if (new Set(refs.map((ref) => ref.input_id)).size !== refs.length) invalid();
  return refs;
}
function frozenInputs(value: unknown): WorkFrozenInput[] {
  const refs = inputRefs(value);
  return array(
    value,
    (item) => {
      const raw = object(item),
        ref = refs.find((ref) => ref.input_id === raw.input_id)!;
      const sha256 = string(raw.sha256, 64),
        name = string(raw.name, 480),
        size_bytes = integer(raw.size_bytes, 10 * 1024 * 1024);
      if (!/^[a-f0-9]{64}$/.test(sha256) || [...name].length > 120 || size_bytes === 0) invalid();
      return { ...ref, name, mime: string(raw.mime, 128), size_bytes, sha256 };
    },
    9
  );
}
function createTask(value: unknown): WorkCreateTask {
  const raw = object(value);
  const repo_path = string(raw.repo_path);
  if (!repo_path.startsWith('/')) return invalid();
  return {
    ...(raw.input_refs === undefined ? {} : { input_refs: inputRefs(raw.input_refs) }),
    repo_path,
    title: string(raw.title, 240),
    brief: string(raw.brief, 65536),
    parent_task_id: nullable(raw.parent_task_id, uuid),
    policy: policy(raw.policy),
  };
}
export function parseWorkTask(value: unknown, sessionId: string, taskId?: string): WorkTask {
  const raw = object(value);
  const { input_refs: _inputRefs, ...input } = createTask(raw);
  return {
    delegation: parseWorkDelegationState(raw.delegation),
    dependencies: parseWorkDependencies(
      raw.dependencies === undefined ? [] : raw.dependencies,
      uuid(raw.id)
    ),
    ...input,
    ...(raw.input_refs === undefined ? {} : { input_refs: frozenInputs(raw.input_refs) }),
    id: matches(uuid(raw.id), taskId),
    session_id: matches(string(raw.session_id, 256), sessionId),
    revision: integer(raw.revision),
    created_at_ms: integer(raw.created_at_ms),
    updated_at_ms: integer(raw.updated_at_ms),
    paused: boolean(raw.paused),
  };
}
export function parseWorkDependencies(value: unknown, taskId?: string): WorkDependency[] {
  const items = array(
    value,
    (value) => {
      const raw = object(value);
      const prerequisite_task_id = uuid(raw.prerequisite_task_id);
      if (prerequisite_task_id === taskId) invalid();
      return { prerequisite_task_id, submission_id: nullable(raw.submission_id, uuid) };
    },
    16
  );
  if (new Set(items.map((item) => item.prerequisite_task_id)).size !== items.length) invalid();
  return items;
}
function binding(value: unknown): WorkBinding {
  const raw = object(value);
  return {
    instance_id: nullable(raw.instance_id, string),
    target: nullable(raw.target, string),
    pane_id: nullable(raw.pane_id, string),
    worktree_path: nullable(raw.worktree_path, string),
    ...(raw.workspace_id === undefined ? {} : { workspace_id: nullable(raw.workspace_id, string) }),
    ...(raw.tab_id === undefined ? {} : { tab_id: nullable(raw.tab_id, string) }),
  };
}
function opaque(value: unknown): string {
  const text = string(value, 256);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) invalid();
  return text;
}
function release(value: unknown): WorkRelease {
  const raw = object(value);
  const evidence = object(raw.evidence);
  const reason = enumeration(raw.reason, [
    'startup_not_dispatched',
    'startup_refused_without_process',
    'owned_process_exited',
  ]);
  let parsed: WorkRelease['evidence'];
  if (reason === 'startup_not_dispatched') {
    matches(string(evidence.kind), 'gateway_dispatch_fence');
    parsed = {
      kind: 'gateway_dispatch_fence',
      start_operation_id: uuid(evidence.start_operation_id),
    };
  } else if (reason === 'startup_refused_without_process') {
    matches(string(evidence.kind), 'native_start_refusal');
    parsed = {
      kind: 'native_start_refusal',
      start_operation_id: uuid(evidence.start_operation_id),
      native_owner_epoch: opaque(evidence.native_owner_epoch),
      native_receipt_id: opaque(evidence.native_receipt_id),
    };
  } else {
    matches(string(evidence.kind), 'native_exit_tombstone');
    parsed = {
      kind: 'native_exit_tombstone',
      instance_id: opaque(evidence.instance_id),
      native_owner_epoch: opaque(evidence.native_owner_epoch),
      native_receipt_id: opaque(evidence.native_receipt_id),
    };
  }
  return {
    reason,
    evidence: parsed,
    reconciliation_operation_id: uuid(raw.reconciliation_operation_id),
    released_at_ms: integer(raw.released_at_ms),
  };
}
function lifecycle(value: unknown, instanceId: string | null): WorkLifecycle {
  const raw = object(value);
  const parsed: WorkLifecycle = {
    launch_phase: enumeration(raw.launch_phase, [
      'not_dispatched',
      'dispatch_claimed',
      'launch_confirmed',
      'legacy_unknown',
    ]),
    reservation: enumeration(raw.reservation, ['reserved', 'released']),
    native_owner_epoch: nullable(raw.native_owner_epoch, opaque),
    release: nullable(raw.release, release),
  };
  if ((parsed.reservation === 'released') !== (parsed.release !== null)) invalid();
  if (parsed.launch_phase === 'launch_confirmed' && (!instanceId || !parsed.native_owner_epoch))
    invalid();
  const evidence = parsed.release?.evidence;
  if (evidence && evidence.kind !== 'gateway_dispatch_fence') {
    if (evidence.native_owner_epoch !== parsed.native_owner_epoch) invalid();
    if (evidence.kind === 'native_exit_tombstone' && evidence.instance_id !== instanceId) invalid();
  }
  return parsed;
}
export function parseWorkReconciliation(value: unknown, attemptId: string): WorkReconciliation {
  const raw = object(value);
  const parsed: WorkReconciliation = {
    operation_id: uuid(raw.operation_id),
    attempt_id: matches(uuid(raw.attempt_id), attemptId),
    observation: enumeration(raw.observation, [
      'not_started',
      'live',
      'exited',
      'unknown',
      'already_released',
    ]),
    reservation: enumeration(raw.reservation, ['reserved', 'released']),
    release: nullable(raw.release, release),
    task_revision: integer(raw.task_revision),
  };
  if ((parsed.reservation === 'released') !== (parsed.release !== null)) invalid();
  if (['live', 'unknown'].includes(parsed.observation) && parsed.reservation !== 'reserved')
    invalid();
  if (
    ['not_started', 'exited', 'already_released'].includes(parsed.observation) &&
    parsed.reservation !== 'released'
  )
    invalid();
  if (
    parsed.release &&
    parsed.observation !== 'already_released' &&
    parsed.release.reconciliation_operation_id !== parsed.operation_id
  )
    invalid();
  if (parsed.observation === 'exited' && parsed.release?.reason !== 'owned_process_exited')
    invalid();
  if (parsed.observation === 'not_started' && parsed.release?.reason === 'owned_process_exited')
    invalid();
  return parsed;
}
function attempt(value: unknown, taskId: string): WorkAttempt {
  const raw = object(value);
  const resources = binding(raw);
  return {
    ...resources,
    ...(raw.lifecycle === undefined
      ? {}
      : { lifecycle: lifecycle(raw.lifecycle, resources.instance_id) }),
    id: uuid(raw.id),
    task_id: matches(uuid(raw.task_id), taskId),
    agent_kind: string(raw.agent_kind, 64),
    role: enumeration(raw.role, ['lead', 'worker']),
    created_at_ms: integer(raw.created_at_ms),
  };
}
export function parseWorkOperation(
  value: unknown,
  taskId: string,
  operationId?: string
): WorkOperation {
  const raw = object(value);
  const parsed: WorkOperation = {
    ...(raw.input_refs === undefined ? {} : { input_refs: frozenInputs(raw.input_refs) }),
    id: matches(uuid(raw.id), operationId),
    task_id: matches(uuid(raw.task_id), taskId),
    attempt_id: nullable(raw.attempt_id, uuid),
    kind: enumeration(raw.kind, kinds),
    state: enumeration(raw.state, states),
    resources: binding(raw.resources),
    failure_code: nullable(raw.failure_code, (code) => enumeration(code, failures)),
    created_at_ms: integer(raw.created_at_ms),
    updated_at_ms: integer(raw.updated_at_ms),
  };
  if (raw.interruption_receipt !== undefined && raw.interruption_receipt !== null) {
    const receipt = object(raw.interruption_receipt);
    const nativeId = (value: unknown) => {
      const id = string(value, 256);
      if (/[\u0000-\u001f\u007f-\u009f]/.test(id)) invalid();
      return id;
    };
    if (
      parsed.kind !== 'interrupt_attempt' ||
      parsed.state !== 'acknowledged' ||
      !parsed.attempt_id ||
      parsed.failure_code !== null ||
      !parsed.resources.instance_id ||
      receipt.bytes_written !== 1
    )
      invalid();
    parsed.interruption_receipt = {
      operation_id: matches(uuid(receipt.operation_id), parsed.id),
      launch_id: matches(nativeId(receipt.launch_id), parsed.resources.instance_id),
      owner_epoch: nativeId(receipt.owner_epoch),
      receipt_id: nativeId(receipt.receipt_id),
      key: enumeration(receipt.key, ['Escape']),
      bytes_written: 1,
      input_disposition: enumeration(receipt.input_disposition, ['written']),
    };
  }
  if (
    parsed.kind === 'interrupt_attempt' &&
    (!parsed.attempt_id || (parsed.state === 'acknowledged' && !parsed.interruption_receipt))
  )
    invalid();
  return parsed;
}
function artifact(value: unknown): WorkArtifact {
  const raw = object(value);
  const sha256 = string(raw.sha256, 64);
  if (!/^[0-9a-f]{64}$/i.test(sha256)) return invalid();
  return { path: string(raw.path), sha256, size_bytes: integer(raw.size_bytes, 50 * 1024 * 1024) };
}
function resultInput(value: unknown): WorkResultInput {
  const raw = object(value);
  return {
    attempt_id: uuid(raw.attempt_id),
    summary: string(raw.summary, 16384),
    artifacts: array(raw.artifacts, artifact, 32),
    evidence: array(raw.evidence, (item) => string(item, 4096), 32),
  };
}
function result(value: unknown, taskId: string): WorkResult {
  const raw = object(value);
  return {
    ...resultInput(raw),
    id: uuid(raw.id),
    task_id: matches(uuid(raw.task_id), taskId),
    created_at_ms: integer(raw.created_at_ms),
  };
}
function reviewInput(value: unknown): WorkReviewInput {
  const raw = object(value);
  return {
    submission_id: uuid(raw.submission_id),
    decision: enumeration(raw.decision, ['accepted', 'changes_requested']),
    message: nullable(raw.message, (item) => string(item, 16384)),
  };
}
function review(value: unknown, taskId: string): WorkReview {
  const raw = object(value);
  return {
    ...reviewInput(raw),
    id: uuid(raw.id),
    task_id: matches(uuid(raw.task_id), taskId),
    actor_id: string(raw.actor_id, 256),
    created_at_ms: integer(raw.created_at_ms),
  };
}
export function parseWorkDetail(value: unknown, sessionId: string, taskId: string): WorkDetail {
  const raw = object(value);
  const detail: WorkDetail = {
    task: parseWorkTask(raw.task, sessionId, taskId),
    attempts: array(raw.attempts, (item) => attempt(item, taskId)),
    operations: array(raw.operations, (item) => parseWorkOperation(item, taskId)),
    results: array(raw.results, (item) => result(item, taskId)),
    reviews: array(raw.reviews, (item) => review(item, taskId)),
    cursor: integer(raw.cursor),
  };
  if (raw.pages !== undefined) {
    const pages = object(raw.pages);
    detail.pages = {
      attempts: parseWorkPage(pages.attempts, detail.task.revision, null, detail.attempts),
      operations: parseWorkPage(pages.operations, detail.task.revision, null, detail.operations),
      results: parseWorkPage(pages.results, detail.task.revision, null, detail.results),
      reviews: parseWorkPage(pages.reviews, detail.task.revision, null, detail.reviews),
    };
  }
  for (const items of [detail.attempts, detail.operations, detail.results, detail.reviews])
    unique(items);
  const attempts = new Set(detail.attempts.map((item) => item.id));
  const results = new Set(detail.results.map((item) => item.id));
  if (
    (!detail.pages?.attempts.has_more &&
      (detail.operations.some(
        (item) => item.attempt_id !== null && !attempts.has(item.attempt_id)
      ) ||
        detail.results.some((item) => !attempts.has(item.attempt_id)))) ||
    (!detail.pages?.results.has_more &&
      detail.reviews.some((item) => !results.has(item.submission_id)))
  )
    invalid();
  return detail;
}
function parseWorkPage(
  value: unknown,
  revision: number,
  after: string | null,
  items: { id: string }[]
): WorkPage {
  const raw = object(value);
  const page = {
    snapshot_revision: integer(raw.snapshot_revision),
    after_id: nullable(raw.after_id, uuid),
    next_after_id: nullable(raw.next_after_id, uuid),
    has_more: boolean(raw.has_more),
  };
  if (
    page.snapshot_revision !== revision ||
    page.after_id !== after ||
    items.length > 20 ||
    page.has_more !== (page.next_after_id !== null) ||
    (page.has_more && page.next_after_id !== items.at(-1)?.id)
  )
    invalid();
  let previous = after ?? '';
  for (const item of items) {
    if (item.id <= previous) invalid();
    previous = item.id;
  }
  return page;
}
export function parseWorkRecordPage<K extends WorkRecordKind>(
  value: unknown,
  kind: K,
  taskId: string,
  revision: number,
  after: string | null
): WorkRecordPage<K> {
  const raw = object(value);
  const parsers = { attempt, operation: parseWorkOperation, result, review };
  const parser = parsers[enumeration(kind, ['attempt', 'operation', 'result', 'review'])];
  const items = array(raw.items, (item) => parser(item, taskId), 20);
  unique(items);
  return {
    items: items as WorkRecordTypes[K][],
    page: parseWorkPage(raw.page, revision, after, items),
  };
}
export function parseWorkChanges(value: unknown, after: number): WorkChangePage {
  const raw = object(value);
  const page = {
    changes: array(
      raw.changes,
      (value) => {
        const item = object(value);
        return {
          cursor: integer(item.cursor),
          task_id: uuid(item.task_id),
          revision: integer(item.revision),
          kind: string(item.kind, 128),
          entity_id: uuid(item.entity_id),
        };
      },
      1000
    ),
    cursor: integer(raw.cursor),
    reset_required: boolean(raw.reset_required),
  };
  let previous = after;
  for (const item of page.changes) {
    if (item.cursor <= previous || item.cursor > page.cursor) invalid();
    previous = item.cursor;
  }
  if (!page.reset_required && page.cursor < after) invalid();
  return page;
}

/** Keep uncertainty visible; recovery is read-only even after app restart. */
export function workOperationRecovery(
  operation: WorkOperation
): 'check_status' | 'inspect_resources' | 'resolve_refusal' | 'none' {
  const hasResources = Boolean(
    operation.resources.pane_id ||
    operation.resources.tab_id ||
    operation.resources.workspace_id ||
    operation.resources.worktree_path
  );
  if (operation.state === 'acknowledged') return 'none';
  if (operation.state === 'refused') return hasResources ? 'inspect_resources' : 'resolve_refusal';
  return operation.state === 'unconfirmed' && hasResources ? 'inspect_resources' : 'check_status';
}

/** One client owns one captured pairing and one session; mutation calls never retry. */
export function createWorkApi(record: GatewayRecord, sessionId: string, transport: WorkTransport) {
  string(sessionId, 256);
  if (sessionId === '.' || sessionId === '..') invalid();
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  const root = `/api/sessions/${encodeURIComponent(sessionId)}/work`;
  async function request<T>(
    path: string,
    context: WorkRequestContext,
    parse: (value: unknown) => T,
    body?: Record<string, unknown> & { request_key: string }
  ): Promise<T> {
    const current = () => context.isCurrent() && !context.signal?.aborted;
    assertDeliveryCurrent(current);
    if (body) string(body.request_key, 128);
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    let reply: { status: number; body: unknown };
    try {
      reply = await transport(captured, root + path, {
        ...context,
        isCurrent: current,
        method: body ? 'POST' : 'GET',
        body: serialized,
      });
    } catch (error) {
      if (body) throw new WorkApiError('unconfirmed', 'transport_unconfirmed', body.request_key);
      throw error;
    }
    // Preserve an acknowledged mutation for durable recovery even if navigation changed.
    if (!body) assertDeliveryCurrent(current);
    if (reply.status < 200 || reply.status >= 300) {
      let code = 'http_error';
      try {
        code = string(object(object(reply.body).error).code, 128);
      } catch {
        /* The status remains authoritative; never expose an unvalidated body. */
      }
      const refusal =
        reply.status >= 400 &&
        reply.status < 500 &&
        reply.status !== 408 &&
        code !== 'delivery_unconfirmed';
      throw new WorkApiError(
        body && !refusal ? 'unconfirmed' : 'refused',
        code,
        body?.request_key,
        reply.status
      );
    }
    try {
      return parse(reply.body);
    } catch (error) {
      if (body)
        throw new WorkApiError('unconfirmed', 'invalid_response', body.request_key, reply.status);
      throw error;
    }
  }
  function mutate<T>(
    path: string,
    body: Record<string, unknown> & { request_key: string },
    context: WorkRequestContext,
    parse: (value: unknown) => T
  ) {
    return request(
      path,
      context,
      (value): WorkMutation<T> => {
        const raw = object(value);
        return { value: parse(raw.value), replayed: boolean(raw.replayed) };
      },
      body
    );
  }
  const taskPath = (id: string) => `/tasks/${encodeURIComponent(uuid(id))}`;
  return {
    scope: Object.freeze({ serverId: captured.serverId, sessionId }),
    summaries(
      context: WorkRequestContext,
      afterId: string | null = null,
      snapshotCursor: number | null = null
    ) {
      if (afterId !== null && snapshotCursor === null) invalid();
      return request(
        `/task-summaries?limit=20${afterId !== null ? `&after_id=${encodeURIComponent(uuid(afterId))}` : ''}${snapshotCursor !== null ? `&snapshot_cursor=${integer(snapshotCursor)}` : ''}`,
        context,
        (value) => parseWorkTaskSummaryPage(value, sessionId, afterId, snapshotCursor)
      );
    },
    list(context: WorkRequestContext, afterId: string | null = null, limit = 50) {
      if (!integer(limit, 100)) invalid();
      return request(
        `/tasks?limit=${limit}${afterId ? `&after_id=${encodeURIComponent(uuid(afterId))}` : ''}`,
        context,
        (value) => {
          const raw = object(value);
          const tasks = array(raw.tasks, (item) => parseWorkTask(item, sessionId), limit);
          unique(tasks);
          return { tasks, next_after_id: nullable(raw.next_after_id, uuid) };
        }
      );
    },
    detail(taskId: string, context: WorkRequestContext) {
      return request(taskPath(taskId), context, (value) =>
        parseWorkDetail(value, sessionId, taskId)
      );
    },
    records<K extends WorkRecordKind>(
      taskId: string,
      kind: K,
      revision: number,
      afterId: string | null,
      context: WorkRequestContext
    ) {
      enumeration(kind, ['attempt', 'operation', 'result', 'review']);
      const query = `kind=${kind}&snapshot_revision=${integer(revision)}&limit=20${afterId ? `&after_id=${encodeURIComponent(uuid(afterId))}` : ''}`;
      return request(`${taskPath(taskId)}/records?${query}`, context, (value) =>
        parseWorkRecordPage(value, kind, taskId, revision, afterId)
      );
    },
    result(taskId: string, resultId: string, context: WorkRequestContext) {
      return request(
        `${taskPath(taskId)}/results/${encodeURIComponent(uuid(resultId))}`,
        context,
        (value) => {
          const parsed = result(value, taskId);
          matches(parsed.id, resultId);
          return parsed;
        }
      );
    },
    reviewRecord(taskId: string, reviewId: string, context: WorkRequestContext) {
      return request(
        `${taskPath(taskId)}/reviews/${encodeURIComponent(uuid(reviewId))}`,
        context,
        (value) => {
          const parsed = review(value, taskId);
          matches(parsed.id, reviewId);
          return parsed;
        }
      );
    },
    create(input: WorkCreateTask, requestKey: string, context: WorkRequestContext) {
      return mutate(
        '/tasks',
        { ...createTask(input), request_key: requestKey },
        context,
        (value) => {
          const task = parseWorkTask(value, sessionId);
          if (
            JSON.stringify(inputRefs(task.input_refs ?? [])) !==
            JSON.stringify(inputRefs(input.input_refs ?? []))
          )
            invalid();
          return task;
        }
      );
    },
    setDelegationPaused(
      taskId: string,
      paused: boolean,
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const expectedRevision = integer(revision);
      return mutate(
        `${taskPath(taskId)}/delegation`,
        { paused: boolean(paused), expected_revision: expectedRevision, request_key: requestKey },
        context,
        (value) => {
          const updated = parseWorkTask(value, sessionId);
          matches(updated.id, taskId);
          if (updated.paused !== paused || updated.revision !== expectedRevision + 1) invalid();
          return updated;
        }
      );
    },
    start(
      taskId: string,
      input: { agent_kind: string; role: 'lead' | 'worker'; branch_name?: string | null },
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      return mutate(
        `${taskPath(taskId)}/attempts`,
        {
          agent_kind: string(input.agent_kind, 64),
          role: enumeration(input.role, ['lead', 'worker']),
          ...(input.branch_name === undefined
            ? {}
            : { branch_name: nullable(input.branch_name, (value) => string(value, 256)) }),
          expected_revision: integer(revision),
          request_key: requestKey,
        },
        context,
        (value) => {
          const operation = parseWorkOperation(value, taskId);
          if (operation.kind !== 'start_attempt') invalid();
          return operation;
        }
      );
    },
    deliver(
      taskId: string,
      input: {
        attempt_id: string;
        expected_instance_id: string;
        text: string;
        input_refs?: TaskInputRef[];
      },
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const attemptId = uuid(input.attempt_id);
      return mutate(
        `${taskPath(taskId)}/attempts/${encodeURIComponent(attemptId)}/deliveries`,
        {
          expected_instance_id: string(input.expected_instance_id, 512),
          text: string(input.text, 65536),
          ...(input.input_refs === undefined ? {} : { input_refs: inputRefs(input.input_refs) }),
          expected_revision: integer(revision),
          request_key: requestKey,
        },
        context,
        (value) => {
          const operation = parseWorkOperation(value, taskId);
          if (operation.kind !== 'deliver_prompt' || operation.attempt_id !== attemptId) invalid();
          if (
            JSON.stringify(inputRefs(operation.input_refs ?? [])) !==
            JSON.stringify(inputRefs(input.input_refs ?? []))
          )
            invalid();
          return operation;
        }
      );
    },
    submitResult(
      taskId: string,
      input: WorkResultInput,
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const attemptId = uuid(input.attempt_id);
      return mutate(
        `${taskPath(taskId)}/results`,
        { ...resultInput(input), expected_revision: integer(revision), request_key: requestKey },
        context,
        (value) => {
          const submission = result(value, taskId);
          matches(submission.attempt_id, attemptId);
          return submission;
        }
      );
    },
    review(
      taskId: string,
      input: WorkReviewInput,
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const submissionId = uuid(input.submission_id);
      const decision = input.decision;
      return mutate(
        `${taskPath(taskId)}/reviews`,
        { ...reviewInput(input), expected_revision: integer(revision), request_key: requestKey },
        context,
        (value) => {
          const receipt = review(value, taskId);
          matches(receipt.submission_id, submissionId);
          matches(receipt.decision, decision);
          return receipt;
        }
      );
    },
    operation(taskId: string, operationId: string, context: WorkRequestContext) {
      return request(`/operations/${encodeURIComponent(uuid(operationId))}`, context, (value) =>
        parseWorkOperation(value, taskId, operationId)
      );
    },
    reconcile(
      taskId: string,
      attemptId: string,
      input: WorkReconcileInput,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const id = uuid(attemptId);
      return mutate(
        `${taskPath(taskId)}/attempts/${encodeURIComponent(id)}/reconciliations`,
        {
          request_key: requestKey,
          expected_revision: integer(input.expected_revision),
          expected_instance_id: nullable(input.expected_instance_id, opaque),
          expected_native_owner_epoch: nullable(input.expected_native_owner_epoch, opaque),
        },
        context,
        (value) => {
          const receipt = parseWorkReconciliation(value, id);
          const evidence = receipt.release?.evidence;
          if (evidence && evidence.kind !== 'gateway_dispatch_fence') {
            if (evidence.native_owner_epoch !== input.expected_native_owner_epoch) invalid();
            if (
              evidence.kind === 'native_exit_tombstone' &&
              evidence.instance_id !== input.expected_instance_id
            )
              invalid();
          }
          return receipt;
        }
      );
    },
    interrupt(
      taskId: string,
      attemptId: string,
      input: {
        expected_revision: number;
        expected_instance_id: string;
        expected_native_owner_epoch: string;
      },
      requestKey: string,
      context: WorkRequestContext
    ) {
      const id = uuid(attemptId);
      return mutate(
        `${taskPath(taskId)}/attempts/${encodeURIComponent(id)}/interruptions`,
        {
          request_key: requestKey,
          expected_revision: integer(input.expected_revision),
          expected_instance_id: string(input.expected_instance_id, 256),
          expected_native_owner_epoch: string(input.expected_native_owner_epoch, 256),
        },
        context,
        (value) => {
          const operation = parseWorkOperation(value, taskId);
          matches(operation.kind, 'interrupt_attempt');
          matches(operation.attempt_id ?? '', id);
          matches(operation.resources.instance_id ?? '', input.expected_instance_id);
          if (operation.interruption_receipt)
            matches(operation.interruption_receipt.owner_epoch, input.expected_native_owner_epoch);
          return operation;
        }
      );
    },
    configureDelegation(
      taskId: string,
      input: WorkDelegationConfig,
      revision: number,
      expectedEpoch: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const config = {
        policy: parseWorkDelegationPolicy(input.policy),
        coordinator_attempt_id: nullable(input.coordinator_attempt_id, uuid),
      };
      if (config.policy.enabled && config.coordinator_attempt_id === null) invalid();
      return mutate(
        `${taskPath(taskId)}/delegation-config`,
        { request_key: requestKey, expected_revision: integer(revision), input: config },
        context,
        (value) => {
          const task = parseWorkTask(value, sessionId, taskId);
          if (
            task.revision !== revision + 1 ||
            task.delegation?.coordinator_epoch !== expectedEpoch + 1 ||
            task.delegation.coordinator_attempt_id !== config.coordinator_attempt_id ||
            JSON.stringify(task.delegation.policy) !== JSON.stringify(config.policy)
          )
            invalid();
          return task;
        }
      );
    },
    setDependencies(
      taskId: string,
      dependencies: readonly WorkDependency[],
      revision: number,
      requestKey: string,
      context: WorkRequestContext
    ) {
      const selected = parseWorkDependencies(dependencies, taskId);
      return mutate(
        `${taskPath(taskId)}/dependencies`,
        { request_key: requestKey, expected_revision: integer(revision), dependencies: selected },
        context,
        (value) => {
          const task = parseWorkTask(value, sessionId, taskId);
          if (
            task.revision !== revision + 1 ||
            JSON.stringify(task.dependencies) !== JSON.stringify(selected)
          )
            invalid();
          return task;
        }
      );
    },
    receipt(
      kind: WorkReceiptKind,
      requestKey: string,
      taskId: string | null,
      context: WorkRequestContext,
      attemptId?: string
    ) {
      const key = string(requestKey, 128);
      enumeration(kind, [
        'configure_delegation',
        'set_dependencies',
        'interrupt_attempt',
        'create_task',
        'start_attempt',
        'deliver_prompt',
        'review_result',
        'pause_task',
        'reconcile_attempt',
      ]);
      return request(
        `/receipts?kind=${kind}&request_key=${encodeURIComponent(key)}`,
        context,
        (value): WorkReceipt => {
          const raw = object(value);
          matches(string(raw.kind, 64), kind);
          if (
            kind === 'create_task' ||
            kind === 'pause_task' ||
            kind === 'configure_delegation' ||
            kind === 'set_dependencies'
          ) {
            const task = parseWorkTask(raw.value, sessionId);
            if (taskId) matches(task.id, uuid(taskId));
            return { kind, value: task };
          }
          if (!taskId) invalid();
          if (kind === 'reconcile_attempt') {
            if (!attemptId) invalid();
            const payload = object(raw.value);
            const type = enumeration(payload.receipt_type, ['operation', 'reconciliation']);
            if (type === 'reconciliation')
              return {
                kind,
                value: {
                  receipt_type: type,
                  receipt: parseWorkReconciliation(payload.receipt, uuid(attemptId)),
                },
              };
            const operation = parseWorkOperation(payload.operation, taskId);
            matches(operation.kind, 'reconcile_attempt');
            matches(operation.attempt_id ?? '', uuid(attemptId));
            return { kind, value: { receipt_type: type, operation } };
          }
          if (kind === 'review_result') return { kind, value: review(raw.value, uuid(taskId)) };
          const operation = parseWorkOperation(raw.value, uuid(taskId));
          matches(operation.kind, kind);
          if (kind === 'interrupt_attempt') matches(operation.attempt_id ?? '', uuid(attemptId));
          return { kind, value: operation };
        }
      );
    },
    changes(after: number, context: WorkRequestContext) {
      return request(`/changes?after=${integer(after)}`, context, (value) =>
        parseWorkChanges(value, after)
      );
    },
  };
}
