import { beforeEach, expect, test } from 'bun:test';

import { groupTasks } from '@/lib/server-tasks-state';
import type { TaskState, TaskView } from '@/lib/task-ledger';
import { useServerTasksStore } from '@/stores/server-tasks';

function task(taskId: string, state: TaskState, updatedMs: number): TaskView {
  return { taskId, state, kind: 'command', goal: taskId, binding: { kind: 'none' }, updatedMs };
}

beforeEach(() => {
  useServerTasksStore.setState({ index: {} });
});

test('replace writes one server and stamps the fetch', () => {
  useServerTasksStore.getState().replace('s1', [task('a', 'done', 1), task('b', 'working', 2)]);
  const entry = useServerTasksStore.getState().index.s1;
  expect(entry?.tasks.map((t) => t.taskId)).toEqual(['b', 'a']);
  expect(typeof entry?.fetchedAt).toBe('number');
});

test('upsert replaces a known task in place of the old view', () => {
  const store = useServerTasksStore.getState();
  store.replace('s1', [task('a', 'working', 1)]);
  store.upsert('s1', task('a', 'cancelled', 5));
  expect(useServerTasksStore.getState().index.s1?.tasks).toEqual([task('a', 'cancelled', 5)]);
});

test('an upsert of an unknown task lands in the active group (review focus 2)', () => {
  const store = useServerTasksStore.getState();
  store.replace('s1', [task('a', 'done', 1)]);
  store.upsert('s1', task('fresh', 'working', 9));
  const groups = groupTasks(useServerTasksStore.getState().index.s1?.tasks ?? []);
  expect(groups.active.map((t) => t.taskId)).toEqual(['fresh']);
  expect(groups.finished.map((t) => t.taskId)).toEqual(['a']);
});
