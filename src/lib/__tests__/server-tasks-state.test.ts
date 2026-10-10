import { describe, expect, test } from 'bun:test';
import { createStore } from 'zustand/vanilla';

import {
  activeTaskCount,
  applyListAnswer,
  createServerTasksState,
  isTaskChannelLive,
  replaceTasks,
  sessionsLeftWaiting,
  taskAgeParts,
  upsertTask,
  type ServerTasksIndex,
} from '@/lib/server-tasks-state';
import type { TaskState, TaskView } from '@/lib/task-ledger';

function task(taskId: string, state: TaskState, updatedMs: number): TaskView {
  return {
    taskId,
    state,
    kind: 'delegation',
    goal: `Goal ${taskId}`,
    binding: { kind: 'none' },
    updatedMs,
  };
}

describe('upsertTask', () => {
  test('inserts into a server the index has never seen', () => {
    const next = upsertTask({}, 's1', task('a', 'working', 10));
    expect(next.s1?.tasks.map((t) => t.taskId)).toEqual(['a']);
    expect(next.s1?.fetchedAt).toBeNull();
  });

  test('replaces by taskId and keeps newest first', () => {
    let index: ServerTasksIndex = replaceTasks(
      {},
      's1',
      [task('a', 'working', 10), task('b', 'queued', 20)],
      100
    );
    index = upsertTask(index, 's1', task('a', 'done', 30));
    expect(index.s1?.tasks.map((t) => [t.taskId, t.state])).toEqual([
      ['a', 'done'],
      ['b', 'queued'],
    ]);
    expect(index.s1?.fetchedAt).toBe(100);
  });

  test('an older frame arriving late does not replace a newer view; a tie takes the later frame', () => {
    let index = upsertTask({}, 's1', task('p', 'working', 20));
    const late = upsertTask(index, 's1', task('p', 'queued', 10));
    expect(late).toBe(index);
    index = upsertTask(index, 's1', {
      ...task('p', 'working', 20),
      children: { total: 1, active: 1, waiting: 0, failed: 0 },
    });
    expect(index.s1?.tasks[0]?.children?.total).toBe(1);
  });

  test('leaves other servers alone and does not mutate its input', () => {
    const before = replaceTasks({}, 's2', [task('x', 'done', 1)], 5);
    const after = upsertTask(before, 's1', task('a', 'working', 10));
    expect(after.s2).toBe(before.s2);
    expect(before.s1).toBeUndefined();
  });
});

describe('replaceTasks', () => {
  test('sorts newest first and stamps the fetch time', () => {
    const index = replaceTasks({}, 's1', [task('a', 'done', 1), task('b', 'working', 9)], 42);
    expect(index.s1?.tasks.map((t) => t.taskId)).toEqual(['b', 'a']);
    expect(index.s1?.fetchedAt).toBe(42);
  });

  // held before the answer (view, received at), list answer -> what stays; the request left at 100
  test.each<[string, TaskView[], TaskView[], [string, TaskState][]]>([
    [
      'a done frame newer than the list keeps done',
      [{ ...task('a', 'done', 30), receivedAtMs: 110 }],
      [task('a', 'working', 20)],
      [['a', 'done']],
    ],
    [
      'a newer list replaces an older held view',
      [{ ...task('a', 'working', 20), receivedAtMs: 50 }],
      [task('a', 'done', 30)],
      [['a', 'done']],
    ],
    [
      'a task posted after the request left stays though the list misses it',
      [{ ...task('n', 'queued', 40), receivedAtMs: 120 }],
      [task('a', 'done', 10)],
      [
        ['n', 'queued'],
        ['a', 'done'],
      ],
    ],
    [
      'a task the list no longer names, held from before the request, is gone',
      [{ ...task('old', 'done', 5), receivedAtMs: 90 }],
      [task('a', 'done', 10)],
      [['a', 'done']],
    ],
  ])('%s', (_name, held, list, kept) => {
    const before: ServerTasksIndex = { s1: { tasks: held, fetchedAt: null } };
    const index = replaceTasks(before, 's1', list, 200, 100);
    expect(index.s1?.tasks.map((t) => [t.taskId, t.state])).toEqual(kept);
  });
});

describe('sessionsLeftWaiting', () => {
  const at = (state: TaskState): TaskView => ({
    ...task('t1', state, 1),
    binding: { kind: 'agent_session', agentId: 'opencode', asid: 'ses_1' },
  });
  // stored before -> stored after -> sessions whose question is stale
  test.each<[string, TaskState | null, TaskState, string[]]>([
    ['answered: waiting -> working', 'waiting', 'working', ['ses_1']],
    ['finished: waiting -> done', 'waiting', 'done', ['ses_1']],
    ['still waiting', 'waiting', 'waiting', []],
    ['never seen waiting (the push came first)', 'working', 'working', []],
    ['new to the ledger', null, 'working', []],
  ])('%s', (_name, before, after, stale) => {
    expect(sessionsLeftWaiting(before ? [at(before)] : [], [at(after)])).toEqual(stale);
  });
});

describe('activeTaskCount', () => {
  test('counts every task that has not finished', () => {
    expect(
      activeTaskCount([
        task('a', 'working', 1),
        task('b', 'waiting', 2),
        task('c', 'done', 3),
        task('d', 'failed', 4),
      ])
    ).toBe(2);
    expect(activeTaskCount([])).toBe(0);
  });
});

describe('review focus 1: whether the socket channel is live', () => {
  test('only with ws_events, outside demo, on an open socket', () => {
    expect(isTaskChannelLive({ wsEvents: true, demo: false, socketState: 'open' })).toBe(true);
    expect(isTaskChannelLive({ wsEvents: false, demo: false, socketState: 'open' })).toBe(false);
    expect(isTaskChannelLive({ wsEvents: true, demo: true, socketState: 'open' })).toBe(false);
    expect(isTaskChannelLive({ wsEvents: true, demo: false, socketState: 'paused' })).toBe(false);
    expect(isTaskChannelLive({ wsEvents: true, demo: false, socketState: null })).toBe(false);
  });
});

describe('taskAgeParts', () => {
  test('buckets the age', () => {
    expect(taskAgeParts(0, 30_000)).toEqual({ unit: 'now', value: 0 });
    expect(taskAgeParts(0, 5 * 60_000)).toEqual({ unit: 'minute', value: 5 });
    expect(taskAgeParts(0, 3 * 3_600_000)).toEqual({ unit: 'hour', value: 3 });
    expect(taskAgeParts(0, 2 * 86_400_000)).toEqual({ unit: 'day', value: 2 });
  });
});

describe('applyListAnswer', () => {
  test('a failed refresh keeps the held list and reports the error', () => {
    let index: ServerTasksIndex = replaceTasks({}, 's1', [task('a', 'working', 10)], 1);
    let error = null as string | null;
    applyListAnswer(null, {
      replace: (tasks) => {
        index = replaceTasks(index, 's1', tasks, 2);
      },
      ok: () => {
        error = null;
      },
      fail: () => {
        error = 'unavailable';
      },
    });
    expect(index.s1?.tasks.map((t) => t.taskId)).toEqual(['a']);
    expect(index.s1?.fetchedAt).toBe(1);
    expect(error).toBe('unavailable');
  });

  test('an empty successful answer does clear the list and the error', () => {
    let index: ServerTasksIndex = replaceTasks({}, 's1', [task('a', 'working', 10)], 1);
    let error = 'unavailable' as string | null;
    applyListAnswer([], {
      replace: (tasks) => {
        index = replaceTasks(index, 's1', tasks, 2);
      },
      ok: () => {
        error = null;
      },
      fail: () => {
        error = 'unavailable';
      },
    });
    expect(index.s1?.tasks).toEqual([]);
    expect(error).toBeNull();
  });
});

describe('createServerTasksState', () => {
  // A frame arrives at clock 50; a list read sent at `requestedAtMs` lands at 200 without it.
  test.each<[string, number, string[]]>([
    ['a frame that arrived after the read left survives it', 40, ['n', 'a']],
    ['a frame from before the read left is gone with it', 60, ['a']],
  ])('%s', (_name, requestedAtMs, kept) => {
    let clock = 50;
    const store = createStore(createServerTasksState(() => clock));
    store.getState().upsert('s1', task('n', 'queued', 30));
    expect(store.getState().index.s1?.tasks[0]?.receivedAtMs).toBe(50);
    clock = 200;
    store.getState().replace('s1', [task('a', 'done', 10)], requestedAtMs);
    expect(store.getState().index.s1?.tasks.map((t) => t.taskId)).toEqual(kept);
  });
});
