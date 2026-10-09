import { describe, expect, test } from 'bun:test';

import {
  boundTaskState,
  HOME_IN_PROGRESS_LIMIT,
  homeInProgressTasks,
  homeWaitingTasks,
  taskStateTone,
} from '../home-in-progress';
import type { ServerTasksIndex } from '../server-tasks-state';
import type { TaskBinding, TaskState, TaskView } from '../task-ledger';

function task(
  taskId: string,
  state: TaskState,
  updatedMs: number,
  binding: TaskBinding = { kind: 'none' }
): TaskView {
  return { taskId, state, kind: 'command', goal: taskId, binding, updatedMs };
}

function index(byServer: Record<string, TaskView[]>): ServerTasksIndex {
  return Object.fromEntries(
    Object.entries(byServer).map(([serverId, tasks]) => [serverId, { tasks, fetchedAt: 1 }])
  );
}

describe('homeInProgressTasks', () => {
  test('working, starting and queued only; waiting, idle and finished stay out', () => {
    const tasks = index({
      a: [
        task('w', 'working', 9),
        task('d', 'dispatching', 8),
        task('q', 'queued', 7),
        task('wait', 'waiting', 6),
        task('idle', 'idle_unconfirmed', 5),
        task('done', 'done', 4),
        task('fail', 'failed', 3),
        task('cxl', 'cancelled', 2),
      ],
    });
    const { rows, total } = homeInProgressTasks(tasks, ['a']);
    expect(rows.map((row) => row.task.taskId)).toEqual(['w', 'd', 'q']);
    expect(total).toBe(3);
  });

  test('only the computers asked for, newest change first across them', () => {
    const tasks = index({
      a: [task('a1', 'working', 1), task('a2', 'working', 5)],
      b: [task('b1', 'queued', 3)],
      gone: [task('x', 'working', 99)],
    });
    const { rows } = homeInProgressTasks(tasks, ['a', 'b', 'missing']);
    expect(rows.map((row) => `${row.serverId}:${row.task.taskId}`)).toEqual([
      'a:a2',
      'b:b1',
      'a:a1',
    ]);
  });

  test('capped at the limit, with the whole count for "View all"', () => {
    const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`, 'working', i));
    const { rows, total } = homeInProgressTasks(index({ a: many }), ['a']);
    expect(rows).toHaveLength(HOME_IN_PROGRESS_LIMIT);
    expect(rows[0]!.task.taskId).toBe('t7');
    expect(total).toBe(8);
  });

  test('nothing known is an empty group', () => {
    expect(homeInProgressTasks({}, ['a'])).toEqual({ rows: [], total: 0 });
    expect(homeInProgressTasks(index({ a: [task('d', 'done', 1)] }), [])).toEqual({
      rows: [],
      total: 0,
    });
  });
});

describe('homeWaitingTasks', () => {
  test('waiting tasks only, newest first', () => {
    const tasks = index({
      a: [task('w1', 'waiting', 1), task('run', 'working', 9), task('w2', 'waiting', 4)],
    });
    expect(homeWaitingTasks(tasks, ['a']).map((row) => row.task.taskId)).toEqual(['w2', 'w1']);
  });
});

describe('boundTaskState', () => {
  const bound = (asid: string): TaskBinding => ({ kind: 'agent_session', agentId: 'oc', asid });

  test('an open task bound to the session speaks for it', () => {
    const tasks = [task('t', 'working', 2, bound('ses_1'))];
    expect(boundTaskState(tasks, 'ses_1')).toBe('working');
    expect(boundTaskState([task('t', 'waiting', 2, bound('ses_1'))], 'ses_1')).toBe('waiting');
  });

  test('a finished, unbound or other-session task does not', () => {
    expect(boundTaskState([task('t', 'done', 2, bound('ses_1'))], 'ses_1')).toBeUndefined();
    expect(boundTaskState([task('t', 'working', 2)], 'ses_1')).toBeUndefined();
    expect(boundTaskState([task('t', 'working', 2, bound('ses_2'))], 'ses_1')).toBeUndefined();
    expect(
      boundTaskState(
        [
          task('t', 'working', 2, {
            kind: 'pane',
            sessionId: 'ses_1',
            paneId: 'p1',
          }),
        ],
        'ses_1'
      )
    ).toBeUndefined();
    expect(boundTaskState(undefined, 'ses_1')).toBeUndefined();
    expect(boundTaskState([task('t', 'working', 2, bound('ses_1'))], undefined)).toBeUndefined();
  });

  test('the newest open task wins', () => {
    const tasks = [task('old', 'queued', 1, bound('s')), task('new', 'waiting', 5, bound('s'))];
    expect(boundTaskState(tasks, 's')).toBe('waiting');
  });
});

describe('taskStateTone', () => {
  test('running is info, waiting warns, the rest are quiet', () => {
    expect(taskStateTone('working')).toBe('info');
    expect(taskStateTone('dispatching')).toBe('info');
    expect(taskStateTone('waiting')).toBe('warning');
    expect(taskStateTone('queued')).toBe('textSubtle');
    expect(taskStateTone('idle_unconfirmed')).toBe('textSubtle');
  });
});
