import { expect, test } from 'bun:test';
import { createWorkApi, WorkApiError } from '../work-api';
import {
  parseWorkTaskSummaryPage,
  workSummaryRow,
  workSummaryAttention,
  mergeWorkSummaryRows,
  type WorkTaskSummary,
} from '../work-summaries';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item: WorkTaskSummary = {
  task_id: id(1),
  session_id: 'session',
  parent_task_id: null,
  task_revision: 4,
  title: 'Task',
  repo_path: '/repo',
  paused: false,
  last_activity: { cursor: 8, kind: 'result_submitted', entity_id: id(3) },
  reserved_attempts: 1,
  unresolved_native_operations: 0,
  unreviewed_results: 1,
  latest_result: { submission_id: id(3), review: null },
};
const page = { items: [item], snapshot_cursor: 8, next_after_id: null };
test('compact summaries preserve exact facts without inventing full task bodies or completion', () => {
  const parsed = parseWorkTaskSummaryPage(page, 'session');
  expect(parsed).toEqual(page);
  const row = workSummaryRow(parsed.items[0]);
  expect(row.id).toBe(item.task_id);
  expect('brief' in row).toBe(false);
  expect('policy' in row).toBe(false);
  expect(workSummaryAttention(item)).toEqual(['result_unreviewed']);
  expect(
    workSummaryAttention({
      ...item,
      unresolved_native_operations: 1,
      latest_result: { submission_id: id(3), review: { review_id: id(4), decision: 'accepted' } },
    })
  ).toEqual(['operation_unconfirmed', 'result_unreviewed', 'latest_result_accepted']);
});
test('summary validation rejects cross-session identities, unsafe counts, foreign watermarks and substituted continuations', () => {
  for (const broken of [
    { ...page, items: [{ ...item, session_id: 'other' }] },
    { ...page, items: [{ ...item, task_id: 'not-an-id' }] },
    { ...page, items: [{ ...item, parent_task_id: item.task_id }] },
    { ...page, items: [{ ...item, reserved_attempts: -1 }] },
    { ...page, items: [{ ...item, unreviewed_results: 0 }] },
    { ...page, items: [{ ...item, task_revision: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...page, items: [{ ...item, last_activity: { ...item.last_activity, cursor: 9 } }] },
    {
      ...page,
      items: [
        {
          ...item,
          latest_result: {
            submission_id: id(3),
            review: { review_id: 'foreign', decision: 'accepted' },
          },
        },
      ],
    },
    { ...page, next_after_id: id(9) },
    { ...page, items: [item, item] },
    { ...page, extra: 'x'.repeat(128 * 1024) },
  ])
    expect(() => parseWorkTaskSummaryPage(broken, 'session')).toThrow();
  expect(() => parseWorkTaskSummaryPage(page, 'session', id(1), 8)).toThrow();
  expect(() => parseWorkTaskSummaryPage(page, 'session', null, 7)).toThrow();
  expect(() =>
    parseWorkTaskSummaryPage(
      {
        ...page,
        items: Array.from({ length: 21 }, (_, index) => ({ ...item, task_id: id(index + 1) })),
      },
      'session'
    )
  ).toThrow();
});
test('summary pagination appends one pinned snapshot and rejects mixing or replay without changing original rows', () => {
  const rows = [workSummaryRow(item)];
  const next = { ...page, items: [{ ...item, task_id: id(2) }] };
  expect(mergeWorkSummaryRows(rows, next, 8).map((row) => row.id)).toEqual([id(1), id(2)]);
  expect(() => mergeWorkSummaryRows(rows, { ...next, snapshot_cursor: 9 }, 8)).toThrow();
  expect(() => mergeWorkSummaryRows(rows, page, 8)).toThrow();
  expect(rows).toHaveLength(1);
  expect(rows[0].summary).toBe(item);
});
test('summary API uses one captured request per page and preserves revision conflict for explicit refresh', async () => {
  const calls: string[] = [];
  let conflict = false;
  const api = createWorkApi(
    {
      serverId: 'gateway',
      label: 'Gateway',
      url: 'https://example.invalid',
      token: 'paired',
      pairedAt: 1,
    },
    'session',
    async (_record, path, request) => {
      expect(request.method).toBe('GET');
      calls.push(path);
      if (conflict)
        return {
          status: 409,
          body: { error: { code: 'revision_conflict', message: 'Refresh snapshot' } },
        };
      return {
        status: 200,
        body: path.includes('after_id')
          ? { ...page, items: [{ ...item, task_id: id(2) }] }
          : { ...page, next_after_id: id(1) },
      };
    }
  );
  const context = { isCurrent: () => true };
  const first = await api.summaries(context);
  await api.summaries(context, first.next_after_id, first.snapshot_cursor);
  expect(calls).toEqual([
    '/api/sessions/session/work/task-summaries?limit=20',
    `/api/sessions/session/work/task-summaries?limit=20&after_id=${id(1)}&snapshot_cursor=8`,
  ]);
  conflict = true;
  const failed = await api.summaries(context, id(1), 8).catch((error: unknown) => error);
  expect(failed instanceof WorkApiError).toBe(true);
  expect((failed as WorkApiError).code).toBe('revision_conflict');
  expect(calls).toHaveLength(3);
});
