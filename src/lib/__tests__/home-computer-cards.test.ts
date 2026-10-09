import { describe, expect, test } from 'bun:test';

import {
  buildComputerCards,
  buildTaskTree,
  cardLimits,
  dismissedKey,
  groupTaskTree,
  MAX_TASK_SUBSCRIPTIONS,
  PENDING_CLOCK_SKEW_MS,
  taskResultLine,
  taskRollup,
  taskSubscriptionServerIds,
  taskRowDestination,
  taskRowVisual,
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

/** The phone's clock in these tests: every task below finished "just now". */
const NOW = 100;

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

  test('sorted needs-you, working, paused, idle; offline gets no card', () => {
    const cards = buildComputerCards({
      servers: [...servers, { serverId: 'paused' }],
      index: index({
        idle: [task('d', 'done', 1)],
        busy: [task('w', 'working', 2)],
        asks: [task('r', 'working', 3), task('c', 'waiting', 4, { parentTaskId: 'r' })],
        off: [task('w2', 'working', 5)],
        paused: [task('p', 'idle_unconfirmed', 6)],
      }),
      reachability: (id) => (id === 'off' ? 'offline' : 'live'),
      dismissed: new Set(),
      nowMs: NOW,
    });
    expect(cards.map((card) => [card.serverId, card.activity])).toEqual([
      ['asks', 'needs-you'],
      ['busy', 'working'],
      ['paused', 'paused'],
      ['idle', 'idle'],
    ]);
    expect(cards[0]!.now[0]!.children.map((child) => child.taskId)).toEqual(['c']);
  });

  test('now holds open roots by urgency (working, starting, paused), capped; finished leaves out acknowledged tasks', () => {
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
      nowMs: NOW,
    });
    // b has no work and no card, so a's is the only one and gets the room.
    expect(card!.now.map((row) => row.task.taskId)).toEqual(['w1', 'w4', 'w2', 'w3', 'idle']);
    expect(card!.nowTotal).toBe(5);
    expect(card!.finished.map((done) => done.taskId)).toEqual(['f2', 'f3']);
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
      nowMs: NOW,
      pending,
    });
    expect(waiting[0]!.pending).toEqual(pending);
    expect(waiting[0]!.activity).toBe('working');
    const arrived = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({ a: [task('x', 'working', 2)] }),
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
      pending,
    });
    expect(arrived[0]!.pending).toEqual([]);
  });
});

describe('which computers get a card', () => {
  const done = (id: string, at: number) => task(id, 'done', at);
  test.each([
    ['working', [task('w', 'working', 1)], 'live', new Set<string>(), true],
    ['waiting', [task('w', 'waiting', 1)], 'live', new Set<string>(), true],
    ['paused', [task('w', 'idle_unconfirmed', 1)], 'live', new Set<string>(), true],
    ['finished just now', [done('f', NOW - 60_000)], 'live', new Set<string>(), true],
    ['finished an hour ago', [done('f', NOW - 3_600_000)], 'live', new Set<string>(), false],
    ['finished, acknowledged', [done('f', NOW)], 'live', new Set([dismissedKey('a', 'f')]), false],
    ['offline with work', [task('w', 'working', 1)], 'offline', new Set<string>(), false],
    ['no ledger (nothing read)', undefined, 'live', new Set<string>(), false],
  ] as const)('%s', (_name, tasks, reachability, dismissed, shown) => {
    const cards = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: tasks ? index({ a: [...tasks] }) : {},
      reachability: () => reachability,
      dismissed,
      nowMs: NOW,
    });
    expect(cards.length > 0).toBe(shown);
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
      nowMs: NOW,
    });
    expect(card!.activity).toBe('working');
    expect(card!.now.map((row) => [row.task.taskId, row.children.map((c) => c.taskId)])).toEqual([
      ['root', ['child']],
    ]);
    expect(card!.finished).toEqual([]);
  });

  test('the gateway count keeps a finished root open for children beyond the page', () => {
    const [card] = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({
        a: [task('root', 'done', 5, { children: { total: 1, active: 0, waiting: 1, failed: 0 } })],
      }),
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
    });
    expect(card!.now.map((row) => row.task.taskId)).toEqual(['root']);
    expect(card!.finished).toEqual([]);
    expect(card!.activity).toBe('needs-you');
  });

  test('an open child known only from the count makes the card working', () => {
    const [card] = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: index({
        a: [task('root', 'done', 5, { children: { total: 1, active: 1, waiting: 0, failed: 0 } })],
      }),
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
    });
    expect(card!.activity).toBe('working');
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
      nowMs: NOW,
      pending,
    })[0]!;

  test('an older task with the same goal does not settle it', () => {
    expect(cardFor([task('x', 'failed', 100 - PENDING_CLOCK_SKEW_MS - 1)]).pending).toEqual(
      pending
    );
  });

  test('a computer clock a little behind the phone still settles it', () => {
    expect(cardFor([task('x', 'working', 100 - 30_000, { origin: 'device' })]).pending).toEqual([]);
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

describe('taskRowDestination', () => {
  const session = { kind: 'agent_session', agentId: 'deepseek', asid: 'ses_1' } as const;
  const pane = { kind: 'pane', sessionId: 's', paneId: 'p1', agentId: 'codex' } as const;
  test.each([
    [
      'a session task opens its session',
      task('t', 'done', 1, { binding: session }),
      { kind: 'session', asid: 'ses_1', agentId: 'deepseek' },
    ],
    [
      'a pane task opens its pane',
      task('t', 'idle_unconfirmed', 1, { binding: pane }),
      { kind: 'pane', paneId: 'p1', sessionId: 's' },
    ],
    ['a failed pane task has no pane to open', task('t', 'failed', 1, { binding: pane }), null],
    ['an unbound task opens nothing', task('t', 'queued', 1), null],
  ] as const)('%s', (_name, input, expected) => {
    expect(taskRowDestination(input)).toEqual(expected);
  });
});

describe('taskRowVisual: one state, one icon, one tone, one line, its actions', () => {
  const pane = { kind: 'pane', sessionId: 's', paneId: 'p1', agentId: 'codex' } as const;
  const open = (state: TaskState, extra: Partial<TaskView> = {}) =>
    task('t', state, 1, { binding: pane, ...extra });
  const plain = { canComplete: false, acknowledged: false };
  test.each([
    ['sent', { state: 'sent' } as const, plain, ['send', 'textMuted', false, { kind: 'sent' }, []]],
    [
      'queued',
      open('queued'),
      plain,
      ['loader', 'textMuted', true, { kind: 'starting' }, ['open', 'cancel']],
    ],
    [
      'starting',
      open('dispatching'),
      plain,
      ['loader', 'textMuted', true, { kind: 'starting' }, ['open', 'cancel']],
    ],
    [
      'working, live line',
      open('working', { progress: 'Editing a.tsx' }),
      plain,
      ['loader', 'primary', true, { kind: 'progress', text: 'Editing a.tsx' }, ['open', 'cancel']],
    ],
    [
      'working, no line',
      open('working'),
      plain,
      ['loader', 'primary', true, { kind: 'elapsed' }, ['open', 'cancel']],
    ],
    [
      'needs you, confirmable',
      open('waiting', { summary: 'Allow edit?' }),
      { ...plain, canComplete: true },
      [
        'help',
        'warning',
        false,
        { kind: 'waiting', text: 'Allow edit?' },
        ['open', 'cancel', 'markDone'],
      ],
    ],
    [
      'paused',
      open('idle_unconfirmed', { summary: 'tests pass\nwhat next?' }),
      plain,
      ['pause', 'textMuted', false, { kind: 'paused', text: 'what next?' }, ['open', 'cancel']],
    ],
    [
      'done',
      open('done', { summary: 'PONG' }),
      plain,
      ['check', 'success', false, { kind: 'result', text: 'PONG' }, ['open', 'acknowledge']],
    ],
    [
      'done, acknowledged',
      open('done', { summary: 'PONG' }),
      { ...plain, acknowledged: true },
      ['check', 'success', false, { kind: 'result', text: 'PONG' }, ['open']],
    ],
    [
      'failed with its error, pane gone',
      open('failed', { summary: 'the pane closed' }),
      plain,
      ['x', 'danger', false, { kind: 'error', text: 'the pane closed' }, ['acknowledge']],
    ],
    [
      'failed with an exit code',
      task('t', 'failed', 1, { exitCode: 2 }),
      plain,
      ['x', 'danger', false, { kind: 'exit', code: 2 }, ['acknowledge']],
    ],
    [
      'cancelled',
      open('cancelled'),
      plain,
      ['ban', 'textMuted', false, { kind: 'state' }, ['open', 'acknowledge']],
    ],
  ] as const)('%s', (_name, input, opts, [icon, tone, spins, line, actions]) => {
    expect(taskRowVisual(input, opts)).toEqual({ icon, tone, spins, line, actions: [...actions] });
  });
});
