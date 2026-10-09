import { describe, expect, test } from 'bun:test';

import {
  buildComputerCards,
  buildTaskTree,
  cardLimits,
  dismissedKey,
  groupTaskTree,
  MAX_TASK_SUBSCRIPTIONS,
  taskResultLine,
  taskRollup,
  taskSubscriptionServerIds,
  taskTitle,
} from '../home-computer-cards';
import type { ServerTasksIndex } from '../server-tasks-state';
import type { TaskState, TaskView } from '../task-ledger';

function task(
  taskId: string,
  state: TaskState,
  updatedMs: number,
  extra: Partial<TaskView> = {}
): TaskView {
  return {
    taskId,
    state,
    kind: 'delegation',
    goal: `goal ${taskId}`,
    binding: { kind: 'none' },
    updatedMs,
    ...extra,
  };
}

function index(byServer: Record<string, TaskView[]>): ServerTasksIndex {
  return Object.fromEntries(
    Object.entries(byServer).map(([serverId, tasks]) => [serverId, { tasks, fetchedAt: 1 }])
  );
}

describe('taskSubscriptionServerIds', () => {
  const servers = [
    { serverId: 'a' },
    { serverId: 'b' },
    { serverId: 'c', sshTunnel: { hostId: 'h' } },
    { serverId: 'd' },
    { serverId: 'e' },
    { serverId: 'f' },
  ];

  test('the selected computer first, then the rest in order, at most four', () => {
    expect(taskSubscriptionServerIds({ servers, selectedId: 'e', hasLedger: () => true })).toEqual([
      'e',
      'a',
      'b',
      'd',
    ]);
    expect(MAX_TASK_SUBSCRIPTIONS).toBe(4);
  });

  test('only computers with a ledger; a tunnelled one only when it is selected', () => {
    expect(taskSubscriptionServerIds({ servers, hasLedger: (id) => id !== 'a' })).toEqual([
      'b',
      'd',
      'e',
      'f',
    ]);
    expect(
      taskSubscriptionServerIds({ servers, selectedId: 'c', hasLedger: () => true, max: 2 })
    ).toEqual(['c', 'a']);
  });

  test('the demo is never subscribed', () => {
    expect(
      taskSubscriptionServerIds({
        servers: [{ serverId: 'demo' }, { serverId: 'a' }],
        selectedId: 'demo',
        hasLedger: () => true,
        isDemo: (id) => id === 'demo',
      })
    ).toEqual(['a']);
  });
});

describe('buildTaskTree', () => {
  test('children nest one level under their parent, newest first', () => {
    const tree = buildTaskTree([
      task('root', 'working', 1),
      task('c1', 'working', 5, { parentTaskId: 'root' }),
      task('c2', 'waiting', 7, { parentTaskId: 'root' }),
      task('other', 'done', 3),
    ]);
    expect(tree.map((row) => row.task.taskId)).toEqual(['other', 'root']);
    expect(tree[1]!.children.map((child) => child.taskId)).toEqual(['c2', 'c1']);
  });

  test('a grandchild sits one level under the root, beside its parent', () => {
    const tree = buildTaskTree([
      task('root', 'working', 1),
      task('child', 'working', 2, { parentTaskId: 'root' }),
      task('grand', 'working', 3, { parentTaskId: 'child' }),
    ]);
    expect(tree.map((row) => [row.task.taskId, row.children.map((c) => c.taskId)])).toEqual([
      ['root', ['grand', 'child']],
    ]);
  });

  test('a parent cycle does not hang and keeps every task', () => {
    const tree = buildTaskTree([
      task('a', 'working', 1, { parentTaskId: 'b' }),
      task('b', 'working', 2, { parentTaskId: 'a' }),
    ]);
    expect(
      tree
        .flatMap((row) => [row.task, ...row.children])
        .map((t) => t.taskId)
        .sort()
    ).toEqual(['a', 'b']);
  });

  test('a child whose parent was not read stands as a root', () => {
    const tree = buildTaskTree([task('orphan', 'working', 2, { parentTaskId: 'gone' })]);
    expect(tree).toEqual([
      { task: task('orphan', 'working', 2, { parentTaskId: 'gone' }), children: [] },
    ]);
  });
});

describe('roll-up, result and title', () => {
  test('the gateway count, or nothing without children', () => {
    expect(
      taskRollup(
        task('r', 'working', 1, { children: { total: 2, active: 1, waiting: 1, failed: 0 } })
      )
    ).toEqual({ total: 2, waiting: 1 });
    expect(
      taskRollup(
        task('r', 'working', 1, { children: { total: 0, active: 0, waiting: 0, failed: 0 } })
      )
    ).toBeNull();
    expect(taskRollup(task('r', 'working', 1))).toBeNull();
  });

  test('the last line of the summary, else the exit code', () => {
    expect(taskResultLine(task('t', 'done', 1, { summary: 'compiled\n\nall green \n' }))).toEqual({
      kind: 'summary',
      text: 'all green',
    });
    expect(taskResultLine(task('t', 'failed', 1, { exitCode: 2 }))).toEqual({
      kind: 'exit',
      code: 2,
    });
    expect(taskResultLine(task('t', 'cancelled', 1))).toBeNull();
  });

  test('the label wins over the goal; the goal is cut to its first line', () => {
    expect(taskTitle(task('t', 'done', 1, { label: 'fix test' }))).toBe('fix test');
    expect(taskTitle(task('t', 'done', 1, { goal: 'line one\nline two' }))).toBe('line one');
  });
});

describe('buildComputerCards', () => {
  const servers = [
    { serverId: 'idle' },
    { serverId: 'busy' },
    { serverId: 'asks' },
    { serverId: 'off' },
  ];

  test('sorted needs-you, working, idle, offline', () => {
    const cards = buildComputerCards({
      servers,
      index: index({
        idle: [task('d', 'done', 1)],
        busy: [task('w', 'working', 2)],
        asks: [task('r', 'working', 3), task('c', 'waiting', 4, { parentTaskId: 'r' })],
        off: [task('w2', 'working', 5)],
      }),
      reachability: (id) => (id === 'off' ? 'offline' : 'live'),
      dismissed: new Set(),
    });
    expect(cards.map((card) => [card.serverId, card.activity])).toEqual([
      ['asks', 'needs-you'],
      ['busy', 'working'],
      ['idle', 'idle'],
      ['off', 'offline'],
    ]);
    expect(cards[0]!.now[0]!.children.map((child) => child.taskId)).toEqual(['c']);
  });

  test('now holds open roots only, capped; finished leaves out acknowledged tasks', () => {
    const tasks = [
      task('w1', 'working', 10),
      task('w2', 'queued', 9),
      task('w3', 'dispatching', 8),
      task('w4', 'working', 7),
      task('idle', 'idle_unconfirmed', 6),
      task('f1', 'done', 5),
      task('f2', 'failed', 4),
      task('f3', 'cancelled', 3),
    ];
    const [card] = buildComputerCards({
      servers: [{ serverId: 'a' }, { serverId: 'b' }],
      index: index({ a: tasks }),
      reachability: () => 'live',
      dismissed: new Set([dismissedKey('a', 'f1')]),
    });
    expect(card!.now.map((row) => row.task.taskId)).toEqual(['w1', 'w2', 'w3']);
    expect(card!.nowTotal).toBe(4);
    expect(card!.finished.map((done) => done.taskId)).toEqual(['f2', 'f3']);
    expect(card!.lastFinished?.taskId).toBe('f1');
  });

  test('one computer gets more room', () => {
    expect(cardLimits(1)).toEqual({ now: 5, finished: 3 });
    expect(cardLimits(3)).toEqual({ now: 3, finished: 2 });
  });

  test('a sent goal shows until a task with that goal arrives', () => {
    const pending = [{ id: 'p', serverId: 'a', goal: 'goal x', atMs: 1 }];
    const waiting = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: {},
      reachability: () => 'live',
      dismissed: new Set(),
      pending,
    });
    expect(waiting[0]!.pending).toEqual(pending);
    expect(waiting[0]!.activity).toBe('working');
    expect(waiting[0]!.known).toBe(false);
    const arrived = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({ a: [task('x', 'working', 2)] }),
      reachability: () => 'live',
      dismissed: new Set(),
      pending,
    });
    expect(arrived[0]!.pending).toEqual([]);
  });
});

describe('work that outlives its root', () => {
  test('a finished root with a working child stays in Now and the card is working', () => {
    const [card] = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({
        a: [task('root', 'done', 5), task('child', 'working', 6, { parentTaskId: 'root' })],
      }),
      reachability: () => 'live',
      dismissed: new Set(),
    });
    expect(card!.activity).toBe('working');
    expect(card!.now.map((row) => [row.task.taskId, row.children.map((c) => c.taskId)])).toEqual([
      ['root', ['child']],
    ]);
    expect(card!.finished).toEqual([]);
    expect(card!.lastFinished).toBeUndefined();
  });

  test('the gateway count keeps a finished root open for children beyond the page', () => {
    const [card] = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({
        a: [task('root', 'done', 5, { children: { total: 1, active: 0, waiting: 1, failed: 0 } })],
      }),
      reachability: () => 'live',
      dismissed: new Set(),
    });
    expect(card!.now.map((row) => row.task.taskId)).toEqual(['root']);
    expect(card!.finished).toEqual([]);
  });
});

describe('the Sent row', () => {
  const pending = [{ id: 'p', serverId: 'a', goal: 'goal x', atMs: 100 }];
  const cardFor = (tasks: TaskView[]) =>
    buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({ a: tasks }),
      reachability: () => 'live',
      dismissed: new Set(),
      pending,
    })[0]!;

  test('an older task with the same goal does not settle it', () => {
    expect(cardFor([task('x', 'failed', 50)]).pending).toEqual(pending);
  });

  test('a task from elsewhere does not settle it; a device task does', () => {
    expect(cardFor([task('x', 'working', 150, { origin: 'mcp' })]).pending).toEqual(pending);
    expect(cardFor([task('x', 'working', 150, { origin: 'device' })]).pending).toEqual([]);
  });
});

describe('groupTaskTree', () => {
  test('a root goes where its most urgent work is', () => {
    const groups = groupTaskTree(
      buildTaskTree([
        task('asks', 'working', 1),
        task('asks-child', 'waiting', 2, { parentTaskId: 'asks' }),
        task('busy', 'done', 3),
        task('busy-child', 'working', 4, { parentTaskId: 'busy' }),
        task('over', 'done', 5),
      ])
    );
    expect(groups.attention.map((t) => t.taskId)).toEqual(['asks']);
    expect(groups.active.map((t) => t.taskId)).toEqual(['busy']);
    expect(groups.finished.map((t) => t.taskId)).toEqual(['over']);
  });
});
