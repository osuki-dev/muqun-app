import { describe, expect, test } from 'bun:test';

import {
  buildComputerCards,
  buildTaskTree,
  cardLimits,
  dismissedKey,
  groupTaskTree,
  PENDING_CLOCK_SKEW_MS,
  taskResultLine,
  taskRollup,
  taskSubscriptionServerIds,
  taskRowVisual,
  taskRowTitle,
  heldCardOrder,
  openTaskWork,
  type TaskRowIcon,
  type TaskRowTone,
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

  test('every reachable ledger is followed, the selected computer first', () => {
    expect(taskSubscriptionServerIds({ servers, selectedId: 'e', hasLedger: () => true })).toEqual([
      'e',
      'a',
      'b',
      'd',
      'f',
    ]);
  });

  test('only computers with a ledger; a tunnelled one only when it is selected', () => {
    expect(taskSubscriptionServerIds({ servers, hasLedger: (id) => id !== 'a' })).toEqual([
      'b',
      'd',
      'e',
      'f',
    ]);
    expect(taskSubscriptionServerIds({ servers, selectedId: 'c', hasLedger: () => true })).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
      'f',
    ]);
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

  // label, gateway title, goal -> the one line a row is named by
  test.each<[string | undefined, string | undefined, string, string]>([
    ['fix test', 'Fix the test', 'Fix it.', 'fix test'],
    [undefined, 'Fix the test', 'Fix it.', 'Fix the test'],
    [undefined, undefined, 'line one\nline two', 'line one'],
    [undefined, undefined, 'Fix v1.2 of the parser. Then run it.', 'Fix v1.2 of the parser'],
    [undefined, undefined, 'Why? Because.', 'Why?'],
    [undefined, undefined, '修好登录页。然后跑测试', '修好登录页'],
    [
      undefined,
      undefined,
      'Read the configuration file under the project root and summarise every option',
      'Read the configuration file under the project root and…',
    ],
    [
      undefined,
      undefined,
      'In /srv/work/checkouts/project-alpha/packages/mobile-app/agent-worktrees/feature run: bun test',
      'In /srv/work/checkouts/project-alpha/packages/mobile-app/ag…',
    ],
  ])('%p / %p / %p', (label, title, goal, shown) => {
    expect(
      taskRowTitle(
        task('t', 'done', 1, { goal, ...(label ? { label } : {}), ...(title ? { title } : {}) })
      )
    ).toBe(shown);
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
  const done = (id: string, at: number, extra: Partial<TaskView> = {}) =>
    task(id, 'done', at, extra);
  test.each([
    ['finished just now', [done('f', NOW - 60_000)], new Set<string>(), true],
    ['finished an hour ago', [done('f', NOW - 3_600_000)], new Set<string>(), false],
    [
      'finished long ago, settled here just now',
      [done('f', NOW - 3_600_000, { settledAtMs: NOW })],
      new Set<string>(),
      true,
    ],
    ['finished, acknowledged', [done('f', NOW)], new Set([dismissedKey('a', 'f')]), false],
    ['no ledger (nothing read)', undefined, new Set<string>(), false],
  ] as const)('%s', (_name, tasks, dismissed, shown) => {
    const cards = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: tasks ? index({ a: [...tasks] }) : {},
      reachability: () => 'live',
      dismissed,
      nowMs: NOW,
    });
    expect(cards.length > 0).toBe(shown);
  });

  test('repeated cancelled attempts at one goal show once; acknowledging it takes the group', () => {
    const finishedIds = (dismissed: Set<string>) =>
      buildComputerCards({
        servers: [{ serverId: 'a' }],
        index: index({
          a: [
            task('old', 'cancelled', 1, { goal: 'retry it' }),
            task('new', 'cancelled', 2, { goal: 'retry it' }),
            task('untitled-1', 'cancelled', 3, { goal: '' }),
            task('untitled-2', 'cancelled', 4, { goal: '' }),
          ],
        }),
        reachability: () => 'live',
        dismissed,
        nowMs: NOW,
        limits: { now: 5, finished: 5 },
      })[0]?.finished.map((t) => t.taskId) ?? [];
    expect(finishedIds(new Set())).toEqual(['untitled-2', 'untitled-1', 'new']);
    expect(finishedIds(new Set([dismissedKey('a', 'new')]))).toEqual(['untitled-2', 'untitled-1']);
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

describe('taskRowVisual: every state has a glyph and a tone', () => {
  test.each<[TaskState | 'sent', TaskRowIcon, TaskRowTone, boolean]>([
    ['sent', 'sent', 'textMuted', false],
    ['queued', 'starting', 'textMuted', false],
    ['dispatching', 'starting', 'textMuted', false],
    ['working', 'working', 'primary', true],
    ['waiting', 'waiting', 'warning', false],
    ['idle_unconfirmed', 'paused', 'textMuted', false],
    ['done', 'done', 'success', false],
    ['failed', 'failed', 'danger', false],
    ['cancelled', 'cancelled', 'textMuted', false],
  ])('%s → %s in %s', (state, icon, tone, spins) => {
    const visual = taskRowVisual(state === 'sent' ? { state } : task('t', state, 1), {
      canComplete: false,
      acknowledged: false,
    });
    expect({ icon: visual.icon, tone: visual.tone, spins: visual.spins }).toEqual({
      icon,
      tone,
      spins,
    });
  });
});

describe('taskRowVisual: the rules the state table carries', () => {
  const pane = { kind: 'pane', sessionId: 's', paneId: 'p1', agentId: 'codex' } as const;
  const open = (state: TaskState, extra: Partial<TaskView> = {}) =>
    task('t', state, 1, { binding: pane, ...extra });
  const plain = { canComplete: false, acknowledged: false };
  test.each([
    [
      'a progress line with no words falls back to the agent',
      open('working', { progress: '──────' }),
      plain,
      { line: { kind: 'agent' }, clock: 'elapsed', actions: ['open', 'cancel'] },
    ],
    [
      'needs you: the warning edge, and Mark done where the gateway takes it',
      open('waiting', { summary: 'Allow edit?' }),
      { ...plain, canComplete: true },
      {
        line: { kind: 'waiting', text: 'Allow edit?' },
        edge: 'warning',
        actions: ['open', 'cancel', 'markDone'],
      },
    ],
    [
      'paused: the hint is the last line, without a marker run into it, and no fill',
      open('idle_unconfirmed', { summary: 'tests pass\nHello. How can I help?MUQUN_TASK_DONE: x' }),
      plain,
      { line: { kind: 'paused', text: 'Hello. How can I help?' } },
    ],
    [
      'an acknowledged task loses Acknowledge',
      open('done', { summary: 'PONG' }),
      { ...plain, acknowledged: true },
      { line: { kind: 'result', text: 'PONG' }, clock: 'ago', actions: ['open'] },
    ],
    [
      'a failed pane task still opens its pane, with its error',
      open('failed', { summary: 'the pane closed' }),
      plain,
      { line: { kind: 'error', text: 'the pane closed' }, actions: ['open', 'acknowledge'] },
    ],
    [
      'a failed task with only an exit code still opens its computer',
      task('t', 'failed', 1, { exitCode: 2 }),
      plain,
      { line: { kind: 'exit', code: 2 }, actions: ['open', 'acknowledge'] },
    ],
    [
      'a working mirror whose computer went quiet says so, and still takes Mark done',
      task('t', 'working', 1, {
        binding: { kind: 'peer', peerId: 'srv-mini', remoteTaskId: 'r' },
        progress: 'running tests',
        peerReachable: false,
        peerLastSeenMs: 40,
      }),
      { ...plain, canComplete: true },
      { line: { kind: 'unreachable', lastSeenMs: 40 }, actions: ['open', 'cancel', 'markDone'] },
    ],
    [
      'a dispatching mirror whose computer never answered takes Mark done',
      task('t', 'dispatching', 1, {
        binding: { kind: 'peer', peerId: 'srv-mini', remoteTaskId: '' },
        peerReachable: false,
      }),
      { ...plain, canComplete: true },
      { line: { kind: 'unreachable' }, actions: ['open', 'cancel', 'markDone'] },
    ],
    [
      "a reachable mirror shows its computer's own progress",
      task('t', 'working', 1, {
        binding: { kind: 'peer', peerId: 'srv-mini', remoteTaskId: 'r' },
        progress: 'running tests',
        peerReachable: true,
      }),
      plain,
      { line: { kind: 'progress', text: 'running tests' } },
    ],
  ] as const)('%s', (_name, input, opts, expected) => {
    expect(taskRowVisual(input, opts)).toMatchObject(expected);
  });
});

describe('openTaskWork on a mirror', () => {
  const mirror = task('m', 'working', 1, {
    binding: { kind: 'peer', peerId: 'peer-1', remoteTaskId: 'r' },
  });
  const there = task('r', 'working', 1, {
    binding: { kind: 'agent_session', agentId: 'opencode', asid: 'ses_9' },
  });
  const known = async (): Promise<TaskView | null> => there;
  test.each([
    [
      'opens the session on the computer that runs it',
      known,
      'srv-mini',
      [['agent', 'srv-mini', 'ses_9']],
    ],
    [
      'without a mapping, the link id is taken as the computer',
      known,
      undefined,
      [['agent', 'peer-1', 'ses_9']],
    ],
    [
      'opens that computer when its task there cannot be read',
      async (): Promise<TaskView | null> => null,
      'srv-mini',
      [['server', 'srv-mini']],
    ],
    ['does nothing without a resolver', undefined, 'srv-mini', []],
  ] as const)('%s', async (_name, resolveTask, mapped, expected) => {
    const opened: string[][] = [];
    const asked: string[] = [];
    openTaskWork(
      {
        openAgent: (serverId, asid) => opened.push(['agent', serverId, asid ?? '']),
        openServer: (serverId) => opened.push(['server', serverId]),
        ...(resolveTask
          ? {
              resolveTask: (serverId: string, taskId: string) => {
                asked.push(`${serverId}/${taskId}`);
                return resolveTask();
              },
            }
          : {}),
        ...(mapped ? { peerServerId: () => mapped } : {}),
      },
      'srv-coding',
      mirror
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toEqual(expected.map((entry) => [...entry]));
    if (resolveTask) expect(asked).toEqual([`${mapped ?? 'peer-1'}/r`]);
  });
});

describe('heldCardOrder', () => {
  const cards = (...ids: string[]) => ids.map((serverId) => ({ serverId }));
  // shown order, newly sorted cards -> what is drawn
  test.each<[string, string[], string[], string[]]>([
    ['nothing held: the sort as given', ['a', 'b'], ['a', 'b'], ['a', 'b']],
    ['a card that rose keeps its old place', ['a', 'b', 'c'], ['c', 'a', 'b'], ['a', 'b', 'c']],
    ['an arrival joins at the end', ['a', 'b'], ['n', 'b', 'a'], ['a', 'b', 'n']],
    ['a card that went is dropped', ['a', 'b', 'c'], ['c', 'a'], ['a', 'c']],
  ])('%s', (_name, shown, sorted, drawn) => {
    expect(heldCardOrder(shown, cards(...sorted)).map((card) => card.serverId)).toEqual(drawn);
  });
});
