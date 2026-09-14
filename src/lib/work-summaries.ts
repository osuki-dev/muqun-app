import type { WorkTask } from './work-api';
import { utf8Bytes } from './multipart';

export type WorkTaskSummary = {
  task_id: string;
  session_id: string;
  parent_task_id: string | null;
  task_revision: number;
  title: string;
  repo_path: string;
  paused: boolean;
  last_activity: { cursor: number; kind: string; entity_id: string } | null;
  reserved_attempts: number;
  unresolved_native_operations: number;
  unreviewed_results: number;
  latest_result: {
    submission_id: string;
    review: { review_id: string; decision: 'accepted' | 'changes_requested' } | null;
  } | null;
};
export type WorkTaskSummaryPage = {
  items: WorkTaskSummary[];
  snapshot_cursor: number;
  next_after_id: string | null;
};
/** List rows do not invent execution policy or task content that the compact API omits. */
export type WorkTaskRow = Pick<
  WorkTask,
  'id' | 'session_id' | 'parent_task_id' | 'revision' | 'title' | 'repo_path' | 'paused'
> & { summary?: WorkTaskSummary };
export type WorkSummaryAttention =
  | 'operation_unconfirmed'
  | 'result_unreviewed'
  | 'latest_result_accepted'
  | 'latest_result_changes_requested';
function invalid(): never {
  throw new Error('Invalid task summary snapshot');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    utf8Bytes(value).length > max ||
    value.includes('\0')
  )
    invalid();
  return value;
}
function uuid(value: unknown): string {
  const id = text(value, 36);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) invalid();
  return id;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function summary(value: unknown, sessionId: string, cursor: number): WorkTaskSummary {
  const raw = object(value);
  const task_id = uuid(raw.task_id),
    session_id = text(raw.session_id, 256),
    repo_path = text(raw.repo_path, 4096);
  const parent_task_id = raw.parent_task_id === null ? null : uuid(raw.parent_task_id);
  if (
    session_id !== sessionId ||
    !repo_path.startsWith('/') ||
    parent_task_id === task_id ||
    typeof raw.paused !== 'boolean'
  )
    invalid();
  let last_activity: WorkTaskSummary['last_activity'] = null;
  if (raw.last_activity !== null) {
    const activity = object(raw.last_activity);
    const at = integer(activity.cursor);
    if (at === 0 || at > cursor) invalid();
    last_activity = {
      cursor: at,
      kind: text(activity.kind, 64),
      entity_id: uuid(activity.entity_id),
    };
  }
  let latest_result: WorkTaskSummary['latest_result'] = null;
  if (raw.latest_result !== null) {
    const latest = object(raw.latest_result);
    let review: NonNullable<WorkTaskSummary['latest_result']>['review'] = null;
    if (latest.review !== null) {
      const value = object(latest.review);
      if (value.decision !== 'accepted' && value.decision !== 'changes_requested') invalid();
      review = { review_id: uuid(value.review_id), decision: value.decision };
    }
    latest_result = { submission_id: uuid(latest.submission_id), review };
  }
  const unreviewed_results = integer(raw.unreviewed_results);
  if (
    (!latest_result && unreviewed_results !== 0) ||
    (latest_result && !latest_result.review && unreviewed_results === 0)
  )
    invalid();
  return {
    task_id,
    session_id,
    parent_task_id,
    repo_path,
    title: text(raw.title, 240),
    task_revision: integer(raw.task_revision),
    paused: raw.paused,
    last_activity,
    reserved_attempts: integer(raw.reserved_attempts),
    unresolved_native_operations: integer(raw.unresolved_native_operations),
    unreviewed_results,
    latest_result,
  };
}
export function parseWorkTaskSummaryPage(
  value: unknown,
  sessionId: string,
  afterId: string | null = null,
  snapshotCursor: number | null = null,
  limit = 20
): WorkTaskSummaryPage {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    (afterId !== null && snapshotCursor === null)
  )
    invalid();
  if (utf8Bytes(JSON.stringify(value)).length > 128 * 1024) invalid();
  const raw = object(value),
    snapshot_cursor = integer(raw.snapshot_cursor);
  if (snapshotCursor !== null && snapshot_cursor !== snapshotCursor) invalid();
  if (!Array.isArray(raw.items) || raw.items.length > limit) invalid();
  let previous = afterId === null ? '' : uuid(afterId);
  const items = raw.items.map((value) => {
    const item = summary(value, sessionId, snapshot_cursor);
    if (item.task_id <= previous) invalid();
    previous = item.task_id;
    return item;
  });
  const next_after_id = raw.next_after_id === null ? null : uuid(raw.next_after_id);
  if (next_after_id !== null && (!items.length || next_after_id !== items.at(-1)?.task_id))
    invalid();
  return { items, snapshot_cursor, next_after_id };
}
export function workSummaryRow(summary: WorkTaskSummary): WorkTaskRow {
  return {
    id: summary.task_id,
    session_id: summary.session_id,
    parent_task_id: summary.parent_task_id,
    revision: summary.task_revision,
    title: summary.title,
    repo_path: summary.repo_path,
    paused: summary.paused,
    summary,
  };
}
export function mergeWorkSummaryRows(
  rows: readonly WorkTaskRow[],
  page: WorkTaskSummaryPage,
  cursor: number
): WorkTaskRow[] {
  if (
    page.snapshot_cursor !== cursor ||
    page.items.some((item) => rows.some((row) => row.id === item.task_id))
  )
    invalid();
  return [...rows, ...page.items.map(workSummaryRow)];
}
/** Independent durable facts, never an agent-running or task-completed state machine. */
export function workSummaryAttention(summary: WorkTaskSummary): WorkSummaryAttention[] {
  const facts: WorkSummaryAttention[] = [];
  if (summary.unresolved_native_operations > 0) facts.push('operation_unconfirmed');
  if (summary.unreviewed_results > 0) facts.push('result_unreviewed');
  if (summary.latest_result?.review?.decision === 'accepted') facts.push('latest_result_accepted');
  if (summary.latest_result?.review?.decision === 'changes_requested')
    facts.push('latest_result_changes_requested');
  return facts;
}
