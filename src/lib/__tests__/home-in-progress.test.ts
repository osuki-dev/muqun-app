import { describe, expect, test } from 'bun:test';

import { boundTask, homeWaitingTasks, needsYouAcrossComputers } from '../home-in-progress';
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
  test('waiting tasks only, newest first; a mirror by its own state', () => {
    const mirror: TaskBinding = { kind: 'peer', peerId: 'peer-1', remoteTaskId: 'r' };
    const tasks = index({
      a: [
        task('w1', 'waiting', 1),
        task('run', 'working', 9),
        task('w2', 'waiting', 4),
        task('m-run', 'working', 8, mirror),
        task('m-wait', 'waiting', 3, mirror),
      ],
    });
    expect(homeWaitingTasks(tasks, ['a']).map((row) => row.task.taskId)).toEqual([
      'w2',
      'm-wait',
      'w1',
    ]);
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

describe('needsYouAcrossComputers', () => {
  // waiting tasks by computer -> what the top section lists
  test.each<[string, Record<string, string[]>, string[]]>([
    ['one computer: its card lists them', { a: ['w1', 'w2'] }, []],
    ['two computers: the section lists all', { a: ['w1'], b: ['w2'] }, ['w2', 'w1']],
    ['none', {}, []],
  ])('%s', (_name, byServer, listed) => {
    const tasks = index(
      Object.fromEntries(
        Object.entries(byServer).map(([serverId, ids]) => [
          serverId,
          ids.map((id) => task(id, 'waiting', Number(id.slice(1)))),
        ])
      )
    );
    const rows = homeWaitingTasks(tasks, Object.keys(byServer));
    expect(needsYouAcrossComputers(rows).map((row) => row.task.taskId)).toEqual(listed);
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
