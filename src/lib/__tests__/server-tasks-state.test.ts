import { describe, expect, test } from 'bun:test';

import {
  activeTaskCount,
  applyListAnswer,
  groupTasks,
  isTaskChannelLive,
  replaceTasks,
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
});

describe('groupTasks', () => {
  test('buckets by state', () => {
    const groups = groupTasks([
      task('w', 'waiting', 1),
      task('q', 'queued', 2),
      task('d', 'dispatching', 3),
      task('k', 'working', 4),
      task('i', 'idle_unconfirmed', 5),
      task('ok', 'done', 6),
      task('f', 'failed', 7),
      task('c', 'cancelled', 8),
    ]);
    expect(groups.attention.map((t) => t.taskId)).toEqual(['w']);
    expect(groups.active.map((t) => t.taskId)).toEqual(['i', 'k', 'd', 'q']);
    expect(groups.finished.map((t) => t.taskId)).toEqual(['c', 'f', 'ok']);
  });

  test('caps the finished group at fifty', () => {
    const many = Array.from({ length: 60 }, (_, i) => task(`t${i}`, 'done', i));
    const groups = groupTasks(many);
    expect(groups.finished).toHaveLength(50);
    expect(groups.finished[0]?.taskId).toBe('t59');
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

describe('review focus 2: a frame for a task the list has not loaded', () => {
  test('lands in the active group, ordered by updatedMs', () => {
    let index = replaceTasks({}, 's1', [task('old', 'working', 10), task('new', 'queued', 50)], 1);
    index = upsertTask(index, 's1', task('mcp-made', 'working', 30));
    const groups = groupTasks(index.s1?.tasks ?? []);
    expect(groups.active.map((t) => t.taskId)).toEqual(['new', 'mcp-made', 'old']);
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
