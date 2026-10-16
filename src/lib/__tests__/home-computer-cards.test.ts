import { describe, expect, test } from 'bun:test';

import {
  buildComputerCards,
  buildTaskTree,
  cardLimits,
  acknowledgementsHeld,
  dismissedKey,
  hiddenTaskKey,
  groupTaskTree,
  PENDING_CLOCK_SKEW_MS,
  PENDING_DISPATCH_TTL_MS,
  boundSessionState,
  pendingShown,
  pendingWorking,
  RECENT_FINISHED_MS,
  type BoundSessionState,
  type PendingDispatch,
  taskResultLine,
  taskRollup,
  taskSubscriptionServerIds,
  taskRowVisual,
  taskRowTitle,
  taskRowDestination,
  heldCardOrder,
  openTaskWork,
  lastKnownActivityCaption,
} from '../home-computer-cards';
import type { ServerTasksIndex } from '../server-tasks-state';
import {
  MAX_SERVER_AGENTS,
  SERVER_AGENTS_STALE_AFTER_MS,
  type ServerAgentsSnapshot,
} from '../server-agents';
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

  test("one Home's check says is down is not followed, unless it is the selected one", () => {
    const isOffline = (id: string) => id === 'b' || id === 'e';
    expect(
      taskSubscriptionServerIds({ servers, selectedId: 'e', hasLedger: () => true, isOffline })
    ).toEqual(['e', 'a', 'd', 'f']);
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
    // An older gateway's summary keeps the marker: its words are the summary.
    expect(
      taskResultLine(
        task('t', 'waiting', 1, { summary: 'Checked.\n`MUQUN_TASK_BLOCKED: need the API key`' })
      )
    ).toEqual({ kind: 'summary', text: 'need the API key' });
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
  test('removing an assignment from Home retains its history and hides later activity only there', () => {
    const removed = task('assignment', 'working', NOW, {
      binding: { kind: 'agent_session', agentId: 'codex', asid: 'retained-session' },
    });
    const child = task('child', 'working', NOW, { parentTaskId: removed.taskId });
    const grandchild = task('grandchild', 'waiting', NOW, { parentTaskId: child.taskId });
    const next = task('new-assignment', 'working', NOW);
    const ledger = index({ coding: [removed, child, grandchild, next], other: [removed] });
    const input = {
      servers: [{ serverId: 'coding' }, { serverId: 'other' }],
      index: ledger,
      reachability: () => undefined,
      dismissed: new Set<string>(),
      hidden: new Set([hiddenTaskKey('coding', removed.taskId)]),
      nowMs: NOW,
    };
    expect(
      buildComputerCards(input).map((card) => [
        card.serverId,
        card.now.map((row) => row.task.taskId),
      ])
    ).toEqual([
      ['coding', [next.taskId]],
      ['other', [removed.taskId]],
    ]);
    expect(buildTaskTree(ledger.coding!.tasks)).toHaveLength(2);
    expect(ledger.coding!.tasks).toEqual([removed, child, grandchild, next]);
    expect(taskRowDestination(removed)).toEqual({
      kind: 'session',
      agentId: 'codex',
      asid: 'retained-session',
    });
    for (const state of ['done', 'failed', 'working'] as const) {
      expect(
        buildComputerCards({
          ...input,
          index: index({ coding: [{ ...removed, state, reopenCount: 1 }] }),
        })
      ).toEqual([]);
    }
  });

  test('Gateway-confirmed pane closures disappear from Home without losing history', () => {
    const closed = [
      'the pane closed',
      'the pane closed: notes.md does not exist',
      'pane closed',
    ].map((summary, position) =>
      task(`closed-${position}`, 'failed', NOW, {
        summary,
        origin: 'device',
        binding: { kind: 'pane', sessionId: 'coding', paneId: `gone-${position}` },
      })
    );
    const origin = task('origin', 'done', NOW, {
      binding: { kind: 'agent_session', agentId: 'codex', asid: 'sending-session' },
    });
    const ledger = index({ coding: [...closed, origin] });
    const cards = buildComputerCards({
      servers: [{ serverId: 'coding' }],
      index: ledger,
      reachability: () => 'live',
      dismissed: new Set(),
      pending: [{ id: 'send', serverId: 'coding', goal: closed[0]!.goal, atMs: NOW }],
      nowMs: NOW,
    });
    expect(cards[0]!.finished).toEqual([origin]);
    expect(cards[0]!.pending).toEqual([]);
    expect(ledger.coding!.tasks).toEqual([...closed, origin]);
    expect(taskRowDestination(origin)).toEqual({
      kind: 'session',
      agentId: 'codex',
      asid: 'sending-session',
    });
    expect(buildTaskTree(ledger.coding!.tasks)).toHaveLength(4);
  });

  test('only a fresh complete inventory for the task session proves a pane gone', () => {
    const bound = task('bound', 'working', NOW - 1, {
      receivedAtMs: NOW - 1,
      binding: { kind: 'pane', sessionId: 'routing', paneId: 'terminal' },
    });
    const complete: ServerAgentsSnapshot = {
      serverId: 'coding',
      sessionId: 'routing',
      checkedAtMs: NOW,
      agents: [],
    };
    const listedPane = {
      id: 'terminal',
      paneId: 'terminal',
      name: 'Codex',
      status: 'unknown' as const,
      hasAgent: true,
    };
    const cases: [string, ServerAgentsSnapshot | undefined, boolean][] = [
      ['confirmed gone', complete, false],
      ['live pane', { ...complete, agents: [listedPane] }, true],
      ['loading inventory', undefined, true],
      ['legacy session scope', { ...complete, sessionId: undefined }, true],
      ['another session', { ...complete, sessionId: 'other' }, true],
      ['another computer', { ...complete, serverId: 'other' }, true],
      [
        'stale inventory',
        { ...complete, checkedAtMs: NOW - SERVER_AGENTS_STALE_AFTER_MS - 1 },
        true,
      ],
      ['before the task', { ...complete, checkedAtMs: NOW - 2 }, true],
      [
        'capped inventory',
        {
          ...complete,
          agents: Array.from({ length: MAX_SERVER_AGENTS }, (_, i) => ({
            ...listedPane,
            paneId: `other-${i}`,
          })),
        },
        true,
      ],
      [
        'partial legacy rows',
        { ...complete, agents: [{ ...listedPane, paneId: undefined }] },
        true,
      ],
    ];
    for (const [name, snapshot, shown] of cases) {
      const cards = buildComputerCards({
        servers: [{ serverId: 'coding' }],
        index: index({ coding: [bound] }),
        panesByServer: snapshot ? { coding: snapshot } : {},
        reachability: () => undefined,
        dismissed: new Set(),
        nowMs: NOW,
      });
      expect({
        name,
        shown: cards.some((card) => card.now.some((row) => row.task === bound)),
      }).toEqual({ name, shown });
    }
  });

  test('completed pane tasks and orphan children use the same Home filter', () => {
    const root = task('root', 'working', NOW - 1, {
      binding: { kind: 'pane', sessionId: 'routing', paneId: 'gone' },
    });
    const child = task('child', 'working', NOW - 1, {
      parentTaskId: root.taskId,
      binding: { kind: 'agent_session', agentId: 'codex', asid: 'child-session' },
    });
    const finished = task('finished', 'done', NOW - 1, {
      kind: 'command',
      summary: 'saved command output',
      binding: { kind: 'pane', sessionId: 'routing', paneId: 'gone-too' },
    });
    const ledger = index({ coding: [root, child, finished] });
    const cards = buildComputerCards({
      servers: [{ serverId: 'coding' }],
      index: ledger,
      panesByServer: {
        coding: { serverId: 'coding', sessionId: 'routing', checkedAtMs: NOW, agents: [] },
      },
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
    });
    expect(cards[0]!.now.map((row) => row.task)).toEqual([child]);
    expect(cards[0]!.finished).toEqual([]);
    expect(ledger.coding!.tasks).toEqual([root, child, finished]);
    expect(taskRowDestination(finished)).toEqual({ kind: 'result' });
  });

  test.each(['queued', 'working', 'waiting', 'done', 'failed', 'cancelled'] as const)(
    'remote exec %s stays in its originating conversation, not the receiving card',
    (state) => {
      const parent = task('parent', 'working', NOW, {
        origin: 'device',
        binding: { kind: 'agent_session', agentId: 'opencode', asid: 'origin-session' },
      });
      const mirror = task('mirror', state, NOW, {
        kind: 'command',
        origin: 'agent',
        parentTaskId: parent.taskId,
        binding: { kind: 'peer', peerId: 'mini', remoteTaskId: 'command' },
      });
      const remote = task('command', state, NOW, {
        kind: 'command',
        origin: 'peer',
        binding: { kind: 'pane', paneId: 'scratch', sessionId: 'default' },
      });
      const ledger = index({ source: [parent, mirror], mini: [remote] });
      const cards = buildComputerCards({
        servers: [{ serverId: 'source' }, { serverId: 'mini' }],
        index: ledger,
        reachability: () => 'live',
        dismissed: new Set(),
        nowMs: NOW,
      });
      expect(cards.map((card) => card.serverId)).toEqual(['source']);
      expect(cards[0]!.now[0]!.task).toEqual(parent);
      expect(buildTaskTree(ledger.source!.tasks)[0]!.children).toEqual([mirror]);
      expect(ledger.mini!.tasks).toEqual([remote]);
    }
  );

  test('ordinary commands and actual remote agents still have their own card', () => {
    const tasks = [
      task('device-command', 'done', NOW, { kind: 'command', origin: 'device' }),
      task('legacy-command', 'done', NOW, { kind: 'command' }),
      task('remote-agent', 'done', NOW, { kind: 'delegation', origin: 'peer' }),
    ];
    const [card] = buildComputerCards({
      servers: [{ serverId: 'mini' }],
      index: index({ mini: tasks }),
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
    });
    expect(card!.finished).toHaveLength(3);
  });

  const servers = [
    { serverId: 'idle' },
    { serverId: 'busy' },
    { serverId: 'asks' },
    { serverId: 'off' },
  ];

  test('sorted needs-you, working, paused, idle; offline gets no card', () => {
    const cards = buildComputerCards({
      requests: {
        request: {
          target: {
            kind: 'agent-session',
            serverId: 'asks',
            asid: 'session',
            sessionId: 'session',
            directory: '/work',
          },
          requestIds: ['request'],
          observedAt: NOW,
        },
      },
      servers: [...servers, { serverId: 'paused' }],
      index: index({
        idle: [task('d', 'done', 1)],
        busy: [task('w', 'working', 2)],
        asks: [
          task('r', 'working', 3),
          task('c', 'waiting', 4, {
            parentTaskId: 'r',
            binding: { kind: 'agent_session', agentId: 'agent', asid: 'session' },
          }),
        ],
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

  test('a card whose ledger is not followed sorts as idle, not by its old rows', () => {
    const cards = buildComputerCards({
      servers,
      index: index({
        busy: [task('w', 'working', 2)],
        asks: [task('c', 'waiting', 4)],
      }),
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
      followed: new Set(['busy']),
    });
    expect(cards.map((card) => [card.serverId, card.activity])).toEqual([
      ['busy', 'working'],
      ['asks', 'idle'],
    ]);
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
      dismissed: new Set([dismissedKey('a', { taskId: 'f1' })]),
      nowMs: NOW,
    });
    // b has no work and no card, so a's is the only one and gets the room.
    expect(card!.now.map((row) => row.task.taskId)).toEqual(['w1', 'w4', 'w2', 'w3', 'idle']);
    expect(card!.nowTotal).toBe(5);
    expect(card!.finished.map((done) => done.taskId)).toEqual(['f2', 'f3']);
  });

  test('one computer gets more finished rows', () => {
    expect(cardLimits(1)).toEqual({ now: 5, finished: 3 });
    expect(cardLimits(3)).toEqual({ now: 5, finished: 2 });
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
    // A send that failed keeps its row, but the computer is not busy with it.
    const failed = buildComputerCards({
      servers: [{ serverId: 'a' }],
      index: {},
      reachability: () => 'live',
      dismissed: new Set(),
      nowMs: NOW,
      pending: [{ ...pending[0]!, failed: true as const }],
    });
    expect(failed[0]!.pending).toHaveLength(1);
    expect(failed[0]!.activity).not.toBe('working');
    // A goal sent straight to its session stands for it until that session's
    // task appears, whatever goal text the task carries.
    const bound = { ...pending[0]!, asid: 'as-1' };
    const sessionTask = task('y', 'working', 2, {
      goal: 'renamed by the agent',
      binding: { kind: 'agent_session', agentId: 'a', asid: 'as-1' },
    });
    const boundCards = (tasks: TaskView[]) =>
      buildComputerCards({
        servers: [{ serverId: 'a' }],
        index: tasks.length ? index({ a: tasks }) : {},
        reachability: () => 'live',
        dismissed: new Set(),
        nowMs: NOW,
        pending: [bound],
      })[0]!;
    expect(boundCards([]).activity).toBe('working');
    expect(boundCards([sessionTask]).pending).toEqual([]);
  });
});

describe('which computers get a card', () => {
  const done = (id: string, at: number, extra: Partial<TaskView> = {}) =>
    task(id, 'done', at, extra);
  test.each([
    ['finished just now', [done('f', NOW - 60_000)], new Set<string>(), true],
    ['finished an hour ago', [done('f', NOW - 3_600_000)], new Set<string>(), true],
    ['finished just under a day ago', [done('f', NOW - 86_400_000 + 1)], new Set<string>(), true],
    ['finished exactly a day ago', [done('f', NOW - 86_400_000)], new Set<string>(), true],
    ['finished over a day ago', [done('f', NOW - 86_400_000 - 1)], new Set<string>(), false],
    [
      'finished long ago, settled here just now',
      [done('f', NOW - 2 * 86_400_000, { settledAtMs: NOW })],
      new Set<string>(),
      true,
    ],
    [
      'finished, acknowledged',
      [done('f', NOW)],
      new Set([dismissedKey('a', { taskId: 'f' })]),
      false,
    ],
    // Acknowledged once, reopened and finished again: the new finish is news.
    [
      'finished again after a reopen',
      [done('f', NOW, { reopenCount: 1 })],
      new Set([dismissedKey('a', { taskId: 'f' })]),
      true,
    ],
    [
      'the second finish acknowledged on its own',
      [done('f', NOW, { reopenCount: 1 })],
      new Set([dismissedKey('a', { taskId: 'f', reopenCount: 1 })]),
      false,
    ],
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

  test('an acknowledgement goes when its task is back at work, and only then', () => {
    const acked = [
      dismissedKey('a', { taskId: 'w' }),
      dismissedKey('a', { taskId: 'c' }),
      dismissedKey('a', { taskId: 'gone' }),
    ];
    const ledgers = index({
      a: [task('w', 'working', NOW), task('c', 'cancelled', NOW)],
    });
    // Back at work (an older gateway's only sign): let go. Cancelled, or not
    // in view: kept.
    expect(acknowledgementsHeld(acked, ledgers)).toEqual([acked[1], acked[2]]);
    // Nothing back at work: the same list, untouched.
    const quiet = index({ a: [task('c', 'cancelled', NOW)] });
    expect(acknowledgementsHeld(acked, quiet)).toBe(acked);
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
    expect(finishedIds(new Set([dismissedKey('a', { taskId: 'new' })]))).toEqual([
      'untitled-2',
      'untitled-1',
    ]);
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
    expect(card!.activity).toBe('paused');
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
  test("a bound row waits for the agent's first reply, then follows the session's run", () => {
    const said = (status: string, roles: string[]) => ({
      info: { status },
      timeline: roles.map((role) => ({ role })),
    });
    const cases: [ReturnType<typeof said>, BoundSessionState][] = [
      [said('busy', ['user']), 'waiting'],
      [said('busy', ['user', 'assistant']), 'working'],
      [said('idle', ['user', 'assistant']), 'done'],
      [said('failed', ['user', 'assistant']), 'failed'],
    ];
    expect(cases.map(([snapshot]) => boundSessionState(snapshot))).toEqual(
      cases.map(([, state]) => state)
    );
  });

  test('a plain one goes after two minutes; a failed or session-bound one stays until acted on', () => {
    const at = 1_000;
    const later = at + PENDING_DISPATCH_TTL_MS;
    const sent = { id: 's', serverId: 'a', goal: 'g', atMs: at };
    const cases: [PendingDispatch, number, shown: boolean, working: boolean][] = [
      [sent, at + 1, true, true],
      [sent, later, false, false],
      // A failed send holds its draft: shown, never work.
      [{ ...sent, failed: true }, later, true, false],
      // Sent to its session and no task yet: shown ("no reply yet"), no longer work.
      [{ ...sent, asid: 'as-1' }, at + 1, true, true],
      [{ ...sent, asid: 'as-1' }, later, true, false],
      // The agent replied: the row follows its session's run, however long.
      [{ ...sent, asid: 'as-1', reply: { state: 'working', atMs: at } }, later, true, true],
      [{ ...sent, asid: 'as-1', reply: { state: 'done', atMs: at } }, later, true, false],
      // A finished one stays through the full day, as a finished task does.
      [{ ...sent, asid: 'as-1', reply: { state: 'done', atMs: at } }, at + 86_400_000, true, false],
      [
        { ...sent, asid: 'as-1', reply: { state: 'done', atMs: at } },
        at + RECENT_FINISHED_MS + 1,
        false,
        false,
      ],
    ];
    expect(
      cases.map(([item, now]) => [pendingShown(item, now), pendingWorking(item, now)])
    ).toEqual(cases.map(([, , shown, working]) => [shown, working]));
  });

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

describe('taskRowVisual: two rules no other row pins', () => {
  const states: TaskState[] = [
    'queued',
    'dispatching',
    'working',
    'waiting',
    'idle_unconfirmed',
    'done',
    'failed',
    'cancelled',
  ];
  const visualOf = (state: TaskState) =>
    taskRowVisual(task('t', state, 1), { canComplete: false, acknowledged: false });

  test('only working spins', () => {
    expect(states.filter((state) => visualOf(state).spins)).toEqual(['working']);
  });

  test('remembered work keeps progress and actions without live animation', () => {
    const input = task('t', 'working', 1, { progress: 'Still checking' });
    const live = taskRowVisual(input, { canComplete: true, acknowledged: false });
    const cached = taskRowVisual(input, {
      canComplete: true,
      acknowledged: false,
      statusCurrent: false,
    });
    expect(live.spins).toBe(true);
    expect(cached).toMatchObject({
      spins: false,
      line: live.line,
      clock: live.clock,
      actions: live.actions,
      tone: live.tone,
    });
  });

  test('remembered waiting state keeps its actions without a fresh arrival pulse', () => {
    const input = task('t', 'waiting', 1);
    const live = taskRowVisual(input, { canComplete: false, acknowledged: false });
    const cached = taskRowVisual(input, {
      canComplete: false,
      acknowledged: false,
      statusCurrent: false,
    });
    expect(live.needsYou).toBe(true);
    expect(cached.needsYou).toBeUndefined();
    expect(cached.line).toEqual(live.line);
    expect(cached.actions).toEqual(live.actions);
  });

  test('an idle agent is never shown as done (idle is not done)', () => {
    const idle = visualOf('idle_unconfirmed');
    expect(idle.tone).toBe('textMuted');
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
      'needs you: the warning tone and an arrival pulse, no edge, and Mark done where the gateway takes it',
      open('waiting', { summary: 'Allow edit?' }),
      { ...plain, canComplete: true },
      {
        line: { kind: 'waiting', text: 'Allow edit?' },
        tone: 'warning',
        needsYou: true,
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
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: 'r' },
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
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: '' },
        peerReachable: false,
      }),
      { ...plain, canComplete: true },
      { line: { kind: 'unreachable' }, actions: ['open', 'cancel', 'markDone'] },
    ],
    [
      'a failed mirror is worded from its reason, never its summary',
      task('t', 'failed', 1, {
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: 'r' },
        summary: 'peer_unlinked: cedar was unlinked',
        reason: 'peer_unlinked',
      }),
      plain,
      { line: { kind: 'mirrorFailed', reason: 'peer_unlinked' } },
    ],
    [
      "a refused create (no reason, no task over there) gets the general line, not the gateway's text",
      task('t', 'failed', 1, {
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: '' },
        summary: 'cedar does not take work from other computers',
      }),
      plain,
      { line: { kind: 'mirrorFailed', reason: '' } },
    ],
    [
      "a mirror whose task over there failed shows that task's own summary",
      task('t', 'failed', 1, {
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: 'r' },
        summary: 'tests failed: 3',
      }),
      plain,
      { line: { kind: 'error', text: 'tests failed: 3' } },
    ],
    [
      "a reachable mirror shows its computer's own progress",
      task('t', 'working', 1, {
        binding: { kind: 'peer', peerId: 'srv-cedar', remoteTaskId: 'r' },
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
      'srv-cedar',
      [['agent', 'srv-cedar', 'ses_9']],
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
      'srv-cedar',
      [['server', 'srv-cedar']],
    ],
    ['does nothing without a resolver', undefined, 'srv-cedar', []],
  ] as const)('%s', async (_name, resolveTask, mapped, expected) => {
    const opened: string[][] = [];
    const asked: string[] = [];
    openTaskWork(
      {
        openTaskResult: (serverId, task) => opened.push(['result', serverId, task.taskId]),
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
      'srv-atlas',
      mirror
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(opened).toEqual(expected.map((entry) => [...entry]));
    if (resolveTask) expect(asked).toEqual([`${mapped ?? 'peer-1'}/r`]);
  });
});

describe('command task destinations', () => {
  test.each(['done', 'failed', 'cancelled'] as const)(
    '%s opens the local saved result even when the peer is offline',
    async (state) => {
      const finished = task('command', state, 1, {
        kind: 'command',
        summary: 'saved output\nlast line',
        peerReachable: false,
        binding: { kind: 'peer', peerId: 'offline-peer', remoteTaskId: 'remote-command' },
      });
      const opened: [string, TaskView][] = [];
      await openTaskWork(
        {
          openTaskResult: (serverId, result) => opened.push([serverId, result]),
          openAgent: () => {
            throw new Error('a finished command must not open an agent');
          },
          openServer: () => {
            throw new Error('a finished command must not open a computer or stale pane');
          },
          resolveTask: () => {
            throw new Error('the saved result must not require a peer read');
          },
        },
        'source',
        finished
      );
      expect(opened).toEqual([['source', finished]]);
    }
  );

  test('a receiver command with a closed or reused pane opens its saved result', async () => {
    const finished = task('command', 'done', 1, {
      kind: 'command',
      origin: 'peer',
      exitCode: 0,
      binding: { kind: 'pane', paneId: 'reused', sessionId: 'temporary', shellPid: 123 },
    });
    const opened: TaskView[] = [];
    await openTaskWork(
      {
        openTaskResult: (_serverId, result) => opened.push(result),
        openServer: () => {
          throw new Error('the old pane binding is history');
        },
        openAgent: () => {
          throw new Error('the command has no agent');
        },
      },
      'receiver',
      finished
    );
    expect(opened).toEqual([finished]);
  });

  test('open commands and agent delegations retain their original destinations', () => {
    const pane = { kind: 'pane', paneId: 'live', sessionId: 'session' } as const;
    expect(taskRowDestination(task('c', 'working', 1, { kind: 'command', binding: pane }))).toEqual(
      pane
    );
    for (const state of ['working', 'done'] as const) {
      expect(
        taskRowDestination(
          task('agent', state, 1, {
            binding: { kind: 'agent_session', agentId: 'codex', asid: 'original' },
          })
        )
      ).toEqual({ kind: 'session', agentId: 'codex', asid: 'original' });
    }
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

describe('the "Last known activity" caption keeps its slot and speaks only when the socket is gone', () => {
  test('rows under an open socket are current: the slot is there, the words are not', () => {
    expect(lastKnownActivityCaption({ followed: true, socket: 'open', rows: 2 })).toBe('hidden');
  });

  test('a reconnect in progress, or the app in the background, is not a loss', () => {
    for (const socket of ['connecting', 'backoff', 'paused']) {
      expect(lastKnownActivityCaption({ followed: true, socket, rows: 2 })).toBe('hidden');
    }
  });

  test('a socket gone for good, or never opened, makes the rows history', () => {
    for (const socket of ['idle', 'unauthorized', 'unavailable', 'superseded', undefined]) {
      expect(lastKnownActivityCaption({ followed: true, socket, rows: 2 })).toBe('shown');
    }
  });

  test('no rows, or a card that is not followed, has no slot to reserve', () => {
    expect(lastKnownActivityCaption({ followed: true, socket: 'idle', rows: 0 })).toBe('none');
    expect(lastKnownActivityCaption({ followed: false, socket: 'idle', rows: 3 })).toBe('none');
  });
});
