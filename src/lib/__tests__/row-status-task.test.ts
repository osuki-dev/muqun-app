import { describe, expect, test } from 'bun:test';

import { rowStatusTask } from '../home-in-progress';
import type { TaskState, TaskView } from '../task-ledger';

const task = (taskId: string, state: TaskState, updatedMs: number, asid = 'ses-1'): TaskView => ({
  taskId,
  state,
  kind: 'delegation',
  goal: 'goal',
  binding: { kind: 'agent_session', asid } as TaskView['binding'],
  updatedMs,
});

describe('rowStatusTask', () => {
  // tasks, when the session status was observed -> the task the row reads
  test.each<[string, TaskView[], number | undefined, string | undefined]>([
    ['an open task wins', [task('done', 'done', 30), task('open', 'working', 20)], 50, 'open'],
    ['a task that ended after the observation', [task('a', 'done', 30)], 20, 'a'],
    ['a status observed after it ended stands', [task('a', 'done', 30)], 40, undefined],
    ['no observation: the ended task', [task('a', 'failed', 30)], undefined, 'a'],
    ['another session’s task is not this row’s', [task('a', 'done', 30, 'ses-2')], 20, undefined],
    ['the newest ended task', [task('old', 'done', 25), task('new', 'cancelled', 30)], 20, 'new'],
  ])('%s', (_name, tasks, observedAtMs, expected) => {
    expect(rowStatusTask(tasks, 'ses-1', observedAtMs)?.taskId).toBe(expected);
  });
});
