import { expect, test } from 'bun:test';
import { mergeWorkPage, workExecutionRecordsComplete } from '../work-pagination';
import type { WorkDetail, WorkRecordPage } from '../work-api';

test('selected immutable result prefetched beyond the prefix is deduplicated without substitution', () => {
  const result = {
    id: 'z',
    task_id: 'task',
    attempt_id: 'lead',
    summary: 'Pinned',
    artifacts: [],
    evidence: [],
    created_at_ms: 1,
  };
  const selected = {
    ...detail,
    results: [result],
    pages: { ...detail.pages!, results: { ...complete, next_after_id: 'a', has_more: true } },
  };
  const incoming = { items: [result], page: { ...complete, after_id: 'a' } };
  const merged = mergeWorkPage(selected, 'result', incoming);
  expect(merged.results).toEqual([result]);
  expect(merged.results[0]).toBe(result);
  expect(() =>
    mergeWorkPage(selected, 'result', {
      ...incoming,
      items: [{ ...result, summary: 'Substituted' }],
    })
  ).toThrow();
});

const complete = { snapshot_revision: 2, after_id: null, next_after_id: null, has_more: false };
const detail = {
  task: { id: 'task', revision: 2 },
  attempts: [],
  operations: [],
  results: [],
  reviews: [],
  cursor: 3,
  pages: {
    attempts: { ...complete, next_after_id: 'a', has_more: true },
    operations: complete,
    results: complete,
    reviews: complete,
  },
} as unknown as WorkDetail;
const continuation = {
  items: [{ id: 'b', task_id: 'task', role: 'lead' }],
  page: { ...complete, after_id: 'a' },
} as WorkRecordPage<'attempt'>;

test('continuation preserves other collections and completes execution evidence', () => {
  expect(workExecutionRecordsComplete(detail)).toBe(false);
  const merged = mergeWorkPage(detail, 'attempt', continuation);
  expect(merged.attempts[0].id).toBe('b');
  expect(merged.results).toBe(detail.results);
  expect(workExecutionRecordsComplete(merged)).toBe(true);
  expect(detail.attempts).toHaveLength(0);
});

test('stale revisions, cursors, duplicate records and foreign tasks never merge', () => {
  for (const page of [
    { ...continuation, page: { ...continuation.page, snapshot_revision: 3 } },
    { ...continuation, page: { ...continuation.page, after_id: 'x' } },
    { ...continuation, items: [...continuation.items, ...continuation.items] },
    { ...continuation, items: [{ ...continuation.items[0], task_id: 'foreign' }] },
  ])
    expect(() => mergeWorkPage(detail, 'attempt', page)).toThrow();
  expect(() =>
    mergeWorkPage(mergeWorkPage(detail, 'attempt', continuation), 'attempt', continuation)
  ).toThrow();
});
