import { describe, expect, test } from 'bun:test';

import { boundTask, homeWaitingTasks } from '../home-in-progress';
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

describe('homeWaitingTasks', () => {
  test('waiting tasks only, newest first', () => {
    const tasks = index({
      a: [task('w1', 'waiting', 1), task('run', 'working', 9), task('w2', 'waiting', 4)],
    });
    expect(homeWaitingTasks(tasks, ['a']).map((row) => row.task.taskId)).toEqual(['w2', 'w1']);
  });

  test('a task whose session Needs you already lists is not listed twice', () => {
    const bound = (asid: string): TaskBinding => ({ kind: 'agent_session', agentId: 'oc', asid });
    const tasks = index({
      a: [
        task('dup', 'waiting', 3, bound('ses_1')),
        task('other', 'waiting', 2, bound('ses_2')),
        task('cmd', 'waiting', 1),
      ],
      b: [task('elsewhere', 'waiting', 4, bound('ses_1'))],
    });
    const pending = [{ serverId: 'a', asid: 'ses_1' }];
    expect(homeWaitingTasks(tasks, ['a', 'b'], pending).map((row) => row.task.taskId)).toEqual([
      'elsewhere',
      'other',
      'cmd',
    ]);
  });
});

describe('boundTask', () => {
  const bound = (asid: string): TaskBinding => ({ kind: 'agent_session', agentId: 'oc', asid });

  test('an open task bound to the session speaks for it', () => {
    const tasks = [task('t', 'working', 2, bound('ses_1'))];
    expect(boundTask(tasks, 'ses_1')?.state).toBe('working');
    expect(boundTask([task('t', 'waiting', 2, bound('ses_1'))], 'ses_1')?.state).toBe('waiting');
  });

  test('a finished, unbound or other-session task does not', () => {
    expect(boundTask([task('t', 'done', 2, bound('ses_1'))], 'ses_1')).toBeUndefined();
    expect(boundTask([task('t', 'working', 2)], 'ses_1')).toBeUndefined();
    expect(boundTask([task('t', 'working', 2, bound('ses_2'))], 'ses_1')).toBeUndefined();
    expect(
      boundTask(
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
    expect(boundTask(undefined, 'ses_1')).toBeUndefined();
    expect(boundTask([task('t', 'working', 2, bound('ses_1'))], undefined)).toBeUndefined();
  });

  test('the newest open task wins', () => {
    const tasks = [task('old', 'queued', 1, bound('s')), task('new', 'waiting', 5, bound('s'))];
    expect(boundTask(tasks, 's')?.state).toBe('waiting');
  });
});
