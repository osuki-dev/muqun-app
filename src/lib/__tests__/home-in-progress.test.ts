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
  test('recorded waiting and peer mirrors alone never become requests', () => {
    const tasks = index({
      a: [
        task('blocked', 'waiting', 1),
        task('mirror', 'waiting', 2, { kind: 'peer', peerId: 'b', remoteTaskId: 'remote' }),
      ],
    });
    expect(homeWaitingTasks(tasks, ['a'])).toEqual([]);
  });
  test('working sessions with requests are listed once, newest first', () => {
    const target = (asid: string) => ({
      kind: 'agent-session' as const,
      serverId: 'a',
      asid,
      sessionId: 'session',
      directory: '/work',
    });
    const tasks = index({
      a: [
        task('older', 'working', 1, { kind: 'agent_session', agentId: 'agent', asid: 'older' }),
        task('newer', 'working', 2, { kind: 'agent_session', agentId: 'agent', asid: 'newer' }),
      ],
    });
    const requests = {
      older: { target: target('older'), requestIds: ['one'], observedAt: 3 },
      newer: { target: target('newer'), requestIds: ['two'], observedAt: 3 },
    };
    expect(
      homeWaitingTasks(tasks, ['a'], [], { requests, nowMs: 3 }).map((row) => row.task.taskId)
    ).toEqual(['newer', 'older']);
    expect(
      homeWaitingTasks(tasks, ['a'], [target('newer')], { requests, nowMs: 3 }).map(
        (row) => row.task.taskId
      )
    ).toEqual(['older']);
    expect(homeWaitingTasks(tasks, ['b'], [], { requests, nowMs: 3 })).toEqual([]);
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
    const rows = Object.entries(tasks)
      .flatMap(([serverId, entry]) => (entry?.tasks ?? []).map((task) => ({ serverId, task })))
      .sort((a, b) => b.task.updatedMs - a.task.updatedMs);
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
