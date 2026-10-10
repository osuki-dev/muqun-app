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
  test('waiting tasks only, newest first', () => {
    const tasks = index({
      a: [task('w1', 'waiting', 1), task('run', 'working', 9), task('w2', 'waiting', 4)],
    });
    expect(homeWaitingTasks(tasks, ['a']).map((row) => row.task.taskId)).toEqual(['w2', 'w1']);
  });

  // A question is listed once: the real task when its computer's ledger is
  // here, else the mirror that stands for it.
  const mirror: TaskBinding = {
    kind: 'peer',
    peerId: 'peer-1',
    peerServerId: 'cedar',
    remoteTaskId: 'r',
  };
  test.each([
    [
      'both tasks present: one row, the real one',
      { atlas: [task('m', 'waiting', 3, mirror)], cedar: [task('r', 'waiting', 2)] },
      ['atlas', 'cedar'],
      ['r'],
    ],
    [
      'the real task there is not waiting yet: the mirror is listed',
      { atlas: [task('m', 'waiting', 3, mirror)], cedar: [task('r', 'working', 2)] },
      ['atlas', 'cedar'],
      ['m'],
    ],
    [
      "the running computer's ledger is stale: the mirror is listed",
      { atlas: [task('m', 'waiting', 3, mirror)], cedar: [task('r', 'waiting', 2)] },
      ['atlas'],
      ['m'],
    ],
    [
      'the task there is not known yet: the mirror is listed',
      {
        atlas: [task('m', 'waiting', 3, { ...mirror, remoteTaskId: '' })],
        cedar: [task('r', 'waiting', 2)],
      },
      ['atlas', 'cedar'],
      ['m', 'r'],
    ],
    [
      'the running computer is not paired here: the mirror is listed',
      { atlas: [task('m', 'waiting', 3, mirror)] },
      ['atlas'],
      ['m'],
    ],
  ] as const)('%s', (_name, byServer, fresh, listed) => {
    const tasks = index(
      Object.fromEntries(Object.entries(byServer).map(([id, list]) => [id, [...list]]))
    );
    expect(homeWaitingTasks(tasks, fresh).map((row) => row.task.taskId)).toEqual([...listed]);
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
