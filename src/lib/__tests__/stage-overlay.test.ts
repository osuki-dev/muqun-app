import { describe, expect, test } from 'bun:test';

import type { FormRequest, PermissionRequest, TimelineItem } from '../agent-protocol';
import type { HomeAttentionSnapshot } from '../home-attention';
import type { ServerAgent, ServerAgentsSnapshot } from '../server-agents';
import type { GatewayAgentSessionsSnapshot } from '../home-continue';
import {
  sessionActivity,
  STAGE_ACTIVITY_HOLD_MS,
  stageActivitySubject,
  stageNeeds,
  stageProgress,
  stageProgressLines,
  stageActivitySubjects,
  stageSessionKey,
  stageSingleChoice,
  stageSubtitleStep,
  STAGE_SUBTITLE_MIN_MS,
} from '../stage-overlay';
import type { TaskView } from '../task-ledger';

const NOW = 1_000_000;
const SERVER = 'desk';

const target = (asid: string, serverId = SERVER) => ({
  kind: 'agent-session' as const,
  serverId,
  sessionId: 'herdr',
  directory: '/repo',
  asid,
  agentId: 'opencode',
});

const permission = (id: string, asid = 'a1'): PermissionRequest => ({
  id,
  asid,
  action: 'bash',
  resources: [],
  save: [],
  prompt: 'bun run db:migrate',
  options: [],
});

const form = (id: string, extra: Partial<FormRequest> = {}): FormRequest => ({
  id,
  asid: 'a1',
  title: 'Which database?',
  fields: [
    {
      key: 'db',
      title: 'Database',
      type: 'string',
      when: [],
      options: [
        { value: 'pg', label: 'Postgres' },
        { value: 'lite', label: 'SQLite' },
      ],
    },
  ],
  ...extra,
});

const observation = (
  asid: string,
  requestIds: string[],
  observedAt: number,
  serverId = SERVER
): [string, HomeAttentionSnapshot] => [
  `${serverId}:${asid}`,
  { target: target(asid, serverId), requestIds, observedAt },
];

const task = (taskId: string, extra: Partial<TaskView> = {}): TaskView => ({
  taskId,
  state: 'working',
  kind: 'delegation',
  goal: 'goal',
  binding: { kind: 'pane', sessionId: 'herdr', paneId: 'p1', agentId: 'claude' },
  updatedMs: NOW - 5_000,
  ...extra,
});

const agent = (paneId: string, extra: Partial<ServerAgent> = {}): ServerAgent => ({
  id: `agent-${paneId}`,
  name: `pane ${paneId}`,
  status: 'working',
  hasAgent: true,
  agentLabel: 'claude',
  paneId,
  ...extra,
});

const mirror = (agents: ServerAgent[], checkedAtMs = NOW - 1_000): ServerAgentsSnapshot => ({
  serverId: SERVER,
  checkedAtMs,
  agents,
});

describe('stageNeeds', () => {
  test('nothing waiting shows nothing', () => {
    expect(
      stageNeeds({
        serverId: SERVER,
        observations: {},
        waitingTasks: [],
        panes: mirror([agent('p1')]),
        nowMs: NOW,
      })
    ).toEqual({ top: null, more: 0 });
  });

  test('the live conversation shows its request itself, not its observation', () => {
    const needs = stageNeeds({
      serverId: SERVER,
      thread: { target: target('a1'), permissions: [permission('r1')], forms: [] },
      observations: Object.fromEntries([observation('a1', ['r1'], NOW - 10_000)]),
      waitingTasks: [],
      nowMs: NOW,
    });
    expect(needs.top?.kind).toBe('permission');
    expect(needs.top?.atMs).toBe(NOW - 10_000);
    expect(needs.more).toBe(0);
  });

  test('the most recent request wins and the rest are counted', () => {
    const needs = stageNeeds({
      serverId: SERVER,
      thread: { target: target('a1'), permissions: [permission('r1')], forms: [] },
      observations: Object.fromEntries([
        observation('a1', ['r1'], NOW - 60_000),
        observation('a2', ['x', 'y'], NOW - 1_000),
        // Another computer's requests are not this card's.
        observation('a3', ['z'], NOW, 'laptop'),
      ]),
      waitingTasks: [],
      nowMs: NOW,
    });
    expect(needs.top).toMatchObject({ kind: 'requests', count: 2 });
    expect(needs.more).toBe(2);
  });

  test('a non-blocking question does not wait on the reader', () => {
    const needs = stageNeeds({
      serverId: SERVER,
      thread: {
        target: target('a1'),
        permissions: [],
        forms: [form('f1', { nonblocking: true }), form('f2')],
      },
      observations: {},
      waitingTasks: [],
      nowMs: NOW,
    });
    expect(needs.top).toMatchObject({ kind: 'question', key: 'question:a1:f2' });
    expect(needs.more).toBe(0);
  });

  test('a blocked pane is its waiting task, and one wait seen twice counts once', () => {
    const waiting = task('t1', { state: 'waiting', updatedMs: NOW - 2_000 });
    const needs = stageNeeds({
      serverId: SERVER,
      observations: {},
      waitingTasks: [waiting],
      panes: mirror([agent('p1', { status: 'blocked' })]),
      nowMs: NOW,
    });
    expect(needs.top).toMatchObject({ kind: 'task', agentLabel: 'claude' });
    expect(needs.more).toBe(0);
  });

  test('a stale mirror says nothing about a pane waiting now', () => {
    const blocked = [agent('p1', { status: 'blocked' })];
    const fresh = stageNeeds({
      serverId: SERVER,
      observations: {},
      waitingTasks: [],
      panes: mirror(blocked),
      nowMs: NOW,
    });
    expect(fresh.top).toMatchObject({ kind: 'pane', paneId: 'p1', agentLabel: 'claude' });
    const stale = stageNeeds({
      serverId: SERVER,
      observations: {},
      waitingTasks: [],
      panes: mirror(blocked, 0),
      nowMs: NOW + 24 * 60 * 60_000,
    });
    expect(stale.top).toBeNull();
  });
});

describe('stageSingleChoice', () => {
  test('one short list of options is answerable from the card', () => {
    expect(stageSingleChoice(form('f1'))?.options.map((option) => option.value)).toEqual([
      'pg',
      'lite',
    ]);
  });

  test('a free answer, a condition, a long list or a second field is not', () => {
    const base = form('f1').fields[0]!;
    if (base.type !== 'string') throw new Error('fixture');
    const free = { ...base, custom: true };
    const conditional = { ...base, when: [{ key: 'x', op: 'eq' as const, value: 1 }] };
    const long = {
      ...base,
      options: ['a', 'b', 'c', 'd'].map((value) => ({ value, label: value })),
    };
    for (const fields of [[free], [conditional], [long], [base, base]])
      expect(stageSingleChoice(form('f1', { fields }))).toBeNull();
  });
});

describe('stageProgress', () => {
  test('only a working task with a reported line speaks, the newest first', () => {
    const line = stageProgress({
      tasks: [
        task('t1', { progress: 'running tests…', updatedMs: NOW - 4_000 }),
        task('t2', {
          progress: '  writing   the migration ',
          updatedMs: NOW - 1_000,
          binding: { kind: 'agent_session', agentId: 'opencode', asid: 'a9' },
        }),
        task('t3', { state: 'idle_unconfirmed', progress: 'old line', updatedMs: NOW }),
        task('t4', { progress: undefined, title: 'A title is not progress', updatedMs: NOW }),
      ],
      panes: mirror([agent('p1')]),
      nowMs: NOW,
    });
    expect(line).toEqual({
      agentId: 'opencode',
      key: stageSessionKey('a9', 'opencode'),
      asid: 'a9',
      text: 'writing the migration',
      atMs: NOW - 1_000,
    });
  });

  test('a task whose pane shows its agent idle is not working', () => {
    expect(
      stageProgress({
        tasks: [task('t1', { progress: 'running tests…' })],
        panes: mirror([agent('p1', { status: 'idle' })]),
        nowMs: NOW,
      })
    ).toBeNull();
  });

  test("the followed agent's activity counts when it is newer, until its pane stops", () => {
    const activity = { key: 'pane:p1', paneId: 'p1', text: 'Bash: bun test src', atMs: NOW - 100 };
    const line = stageProgress({
      tasks: [task('t1', { progress: 'running tests…', updatedMs: NOW - 4_000 })],
      panes: mirror([agent('p1')]),
      activity,
      nowMs: NOW,
    });
    expect(line).toMatchObject({
      agentLabel: 'claude',
      key: 'pane:p1',
      text: 'Bash: bun test src',
    });
    expect(
      stageProgress({
        tasks: [],
        panes: mirror([agent('p1', { status: 'idle' })]),
        activity,
        nowMs: NOW,
      })
    ).toBeNull();
  });
});

describe('stageSubtitleStep', () => {
  const a = { key: 'pane:p1', text: 'running tests…' };
  const b = { key: 'pane:p1', text: 'fixing a failure' };

  test('appearing and leaving happen at once', () => {
    expect(stageSubtitleStep({ shown: null, shownAtMs: 0, next: a, nowMs: NOW })).toEqual({
      kind: 'show',
    });
    expect(stageSubtitleStep({ shown: a, shownAtMs: NOW, next: null, nowMs: NOW })).toEqual({
      kind: 'show',
    });
    expect(stageSubtitleStep({ shown: null, shownAtMs: 0, next: null, nowMs: NOW })).toEqual({
      kind: 'keep',
    });
  });

  test('a new line waits out the rest of the interval; the same line is no change', () => {
    expect(stageSubtitleStep({ shown: a, shownAtMs: NOW - 500, next: a, nowMs: NOW })).toEqual({
      kind: 'keep',
    });
    expect(stageSubtitleStep({ shown: a, shownAtMs: NOW - 500, next: b, nowMs: NOW })).toEqual({
      kind: 'wait',
      waitMs: STAGE_SUBTITLE_MIN_MS - 500,
    });
    expect(
      stageSubtitleStep({
        shown: a,
        shownAtMs: NOW - STAGE_SUBTITLE_MIN_MS,
        next: b,
        nowMs: NOW,
      })
    ).toEqual({ kind: 'show' });
  });
});

describe('stageActivitySubject', () => {
  const listing = (
    rows: { asid: string; status: 'busy' | 'idle'; updatedMs: number; paneId?: string }[]
  ): GatewayAgentSessionsSnapshot => ({
    serverId: SERVER,
    sessionId: 'herdr',
    observedAtMs: NOW - 2_000,
    sessions: rows.map((row) => ({
      asid: row.asid,
      agentId: 'opencode',
      title: row.asid,
      directory: '/repo',
      status: row.status,
      updatedMs: row.updatedMs,
      ...(row.paneId ? { terminal: { sessionId: 'herdr', paneId: row.paneId } } : {}),
    })),
  });

  test('the most recently active working agent, not just the reply target', () => {
    const subject = stageActivitySubject({
      serverId: SERVER,
      panes: mirror([agent('p1'), agent('p2', { status: 'idle' })], NOW - 30_000),
      sessions: listing([
        { asid: 's1', status: 'busy', updatedMs: NOW - 5_000 },
        { asid: 's2', status: 'idle', updatedMs: NOW },
      ]),
      dock: { kind: 'pane', paneId: 'p1' },
      activeAtMs: {},
      nowMs: NOW,
    });
    expect(subject).toEqual({
      kind: 'session',
      key: stageSessionKey('s1', 'opencode'),
      sessionId: 'herdr',
      asid: 's1',
      agentId: 'opencode',
      dock: false,
    });
  });

  test('a pane whose screen this device saw change more recently wins', () => {
    const subject = stageActivitySubject({
      serverId: SERVER,
      panes: mirror([agent('p1'), agent('p2')], NOW - 30_000),
      sessions: listing([{ asid: 's1', status: 'busy', updatedMs: NOW - 5_000 }]),
      activeAtMs: { 'pane:p2': NOW - 1_000 },
      nowMs: NOW,
    });
    expect(subject).toMatchObject({ kind: 'pane', paneId: 'p2' });
  });

  test("between equals the dock's own goes first; a session in a pane is followed once", () => {
    expect(
      stageActivitySubject({
        serverId: SERVER,
        panes: mirror([agent('p1'), agent('p2')]),
        dock: { kind: 'pane', paneId: 'p2' },
        activeAtMs: {},
        nowMs: NOW,
      })
    ).toMatchObject({ paneId: 'p2' });
    expect(
      stageActivitySubject({
        serverId: SERVER,
        panes: { ...mirror([agent('p1')], NOW - 3_000), sessionId: 'herdr' },
        sessions: listing([{ asid: 's1', status: 'busy', updatedMs: NOW - 9_000, paneId: 'p1' }]),
        activeAtMs: {},
        nowMs: NOW,
      })
    ).toMatchObject({ kind: 'session', asid: 's1' });
  });

  test("the dock's live status outranks the listing; nothing working is nothing", () => {
    const sessions = listing([{ asid: 's1', status: 'idle', updatedMs: NOW - 9_000 }]);
    expect(
      stageActivitySubject({
        serverId: SERVER,
        sessions,
        dock: { kind: 'session', sessionId: 'herdr', asid: 's1', status: 'busy' },
        activeAtMs: {},
        nowMs: NOW,
      })
    ).toMatchObject({ asid: 's1', dock: true });
    expect(
      stageActivitySubject({
        serverId: SERVER,
        sessions: listing([{ asid: 's1', status: 'busy', updatedMs: NOW }]),
        dock: { kind: 'session', sessionId: 'herdr', asid: 's1', status: 'idle' },
        panes: mirror([agent('p1', { status: 'blocked' }), agent('p2', { hasAgent: false })]),
        activeAtMs: {},
        nowMs: NOW,
      })
    ).toBeNull();
  });

  test('the followed agent is held while its activity keeps changing, then let go', () => {
    const input = {
      serverId: SERVER,
      panes: mirror([agent('p1'), agent('p2')], NOW - 30_000),
      sessions: listing([{ asid: 's1', status: 'busy' as const, updatedMs: NOW - 1_000 }]),
      current: 'pane:p1',
      nowMs: NOW,
    };
    expect(
      stageActivitySubject({ ...input, activeAtMs: { 'pane:p1': NOW - 10_000 } })
    ).toMatchObject({ paneId: 'p1' });
    expect(
      stageActivitySubject({
        ...input,
        activeAtMs: { 'pane:p1': NOW - STAGE_ACTIVITY_HOLD_MS - 1 },
      })
    ).toMatchObject({ asid: 's1' });
  });
});

describe('sessionActivity', () => {
  const item = (id: string, updatedMs: number, part: TimelineItem['part'], role = 'assistant') =>
    ({
      id,
      message_id: 'm1',
      role,
      ordinal: 0,
      part,
      seq: 1,
      updated_ms: updatedMs,
    }) as TimelineItem;
  const tool = (name: string, extra: object) => ({
    type: 'tool' as const,
    id: name,
    name,
    input: {},
    content: [],
    metadata: {},
    state: 'running' as const,
    ...extra,
  });

  test('the newest assistant part: a tool call by its title or main input, or its last line', () => {
    expect(
      sessionActivity([
        item('1', 1, { type: 'text', text: 'Looking at the parser.' }),
        item('2', 2, tool('bash', { title: 'bun test src' })),
      ])
    ).toEqual({ text: 'Bash: bun test src', atMs: 2 });
    expect(
      sessionActivity([item('1', 3, tool('read', { input: { filePath: 'src/a.ts' } }))])
    ).toEqual({ text: 'Read: src/a.ts', atMs: 3 });
    expect(
      sessionActivity([
        item('1', 1, tool('bash', { title: 'bun test src' })),
        item('2', 4, { type: 'text', text: 'Two tests fail.\n\nFixing the first now.\n' }),
      ])
    ).toEqual({ text: 'Fixing the first now.', atMs: 4 });
  });

  test("the reader's words, reasoning and empty parts are not its activity", () => {
    expect(
      sessionActivity([
        item('1', 1, { type: 'text', text: 'Reading.' }),
        item('2', 5, { type: 'text', text: 'please fix it' }, 'user'),
        item('3', 6, { type: 'reasoning', text: 'hmm' }),
        item('4', 7, { type: 'text', text: '   ' }),
      ])
    ).toEqual({ text: 'Reading.', atMs: 1 });
    expect(sessionActivity([])).toBeUndefined();
  });
});

describe('stageProgressLines', () => {
  const panes = {
    ...mirror([agent('p1', { instanceId: 'live', shellPid: 42 })]),
    sessionId: 'herdr',
  };
  const sessions: GatewayAgentSessionsSnapshot = {
    serverId: SERVER,
    sessionId: 'herdr',
    observedAtMs: NOW,
    sessions: [
      {
        asid: 'a1',
        agentId: 'claude',
        title: 'same name',
        directory: '/repo',
        status: 'busy',
        updatedMs: NOW - 500,
        terminal: { sessionId: 'herdr', paneId: 'p1' },
      },
    ],
  };
  const paneTask = task('pane', {
    progress: 'older terminal progress',
    binding: { kind: 'pane', sessionId: 'herdr', paneId: 'p1', shellPid: 42, agentId: 'claude' },
  });
  test('merges only a verified pane association and keeps the newest reported line', () => {
    const lines = stageProgressLines({
      serverId: SERVER,
      panes,
      sessions,
      tasks: [paneTask],
      activities: [
        {
          key: stageSessionKey('a1', 'claude'),
          asid: 'a1',
          agentId: 'claude',
          text: 'newer session progress',
          atMs: NOW,
        },
      ],
      nowMs: NOW,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      key: stageSessionKey('a1', 'claude'),
      asid: 'a1',
      text: 'newer session progress',
    });
  });
  test('one conversation prefers its native activity over newer linked terminal reports', () => {
    const native = {
      key: stageSessionKey('a1', 'claude'),
      asid: 'a1',
      agentId: 'claude',
      sessionId: 'herdr',
      text: 'Native session progress',
      atMs: NOW - 100,
    };
    const terminal = { key: 'pane:p1', paneId: 'p1', text: 'Newer terminal screen', atMs: NOW };
    for (const activities of [
      [native, terminal],
      [terminal, native],
    ]) {
      const lines = stageProgressLines({
        serverId: SERVER,
        panes,
        sessions,
        tasks: [{ ...paneTask, updatedMs: NOW, progress: 'Terminal ledger' }],
        activities,
        nowMs: NOW,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        asid: 'a1',
        agentId: 'claude',
        text: 'Native session progress',
        sessionId: 'herdr',
      });
    }
  });
  test('same-name independent sessions and unassociated terminals stay separate before the five-row limit', () => {
    const listed = {
      ...sessions,
      sessions: Array.from({ length: 5 }, (_, index) => ({
        ...sessions.sessions[0]!,
        asid: `a${index + 1}`,
        terminal: index === 0 ? sessions.sessions[0]!.terminal : undefined,
      })),
    };
    const otherPane = agent('independent', { agentLabel: 'claude' });
    const currentPanes = { ...panes, agents: [...panes.agents, otherPane] };
    const activities = [
      ...listed.sessions.map((session) => ({
        key: stageSessionKey(session.asid, session.agentId),
        asid: session.asid,
        agentId: session.agentId,
        sessionId: 'herdr',
        text: 'Same displayed text',
        atMs: NOW,
      })),
      { key: 'pane:p1', paneId: 'p1', text: 'Linked terminal', atMs: NOW },
      { key: 'pane:independent', paneId: 'independent', text: 'Independent terminal', atMs: NOW },
    ];
    const lines = stageProgressLines({
      serverId: SERVER,
      panes: currentPanes,
      sessions: listed,
      tasks: [],
      activities,
      nowMs: NOW,
    });
    expect(lines).toHaveLength(6);
    expect(lines.filter((line) => line.asid === 'a1')).toHaveLength(1);
    expect(lines.some((line) => line.key === 'pane:independent')).toBe(true);
    expect(
      stageActivitySubjects({
        serverId: SERVER,
        panes: currentPanes,
        sessions: listed,
        activeAtMs: {},
        nowMs: NOW,
      })
    ).toHaveLength(5);
  });
  test('a reused shell, another workspace, and a removed pane cannot revive a ledger subtitle', () => {
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes,
        sessions,
        tasks: [
          {
            ...paneTask,
            binding: { kind: 'pane', sessionId: 'herdr', paneId: 'p1', shellPid: 41 },
          },
        ],
        nowMs: NOW,
      })
    ).toEqual([]);
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes: { ...panes, sessionId: 'other' },
        sessions,
        tasks: [paneTask],
        nowMs: NOW,
      })
    ).toEqual([]);
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes: { ...panes, agents: [] },
        sessions,
        tasks: [paneTask],
        nowMs: NOW,
      })
    ).toEqual([]);
  });
  test('another computer cannot turn a pane subtitle into a session', () => {
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes,
        sessions: { ...sessions, serverId: 'other' },
        tasks: [paneTask],
        nowMs: NOW,
      })[0]?.key
    ).toBe('pane:p1');
  });
  test('fresh idle reports suppress leftover working tasks, but older reports do not override newer work', () => {
    const idle = {
      ...sessions,
      sessions: sessions.sessions.map((session) => ({ ...session, status: 'idle' as const })),
    };
    const nativeTask = task('native', {
      progress: 'old progress',
      binding: { kind: 'agent_session', asid: 'a1', agentId: 'claude' },
    });
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes,
        sessions: idle,
        tasks: [paneTask, nativeTask],
        nowMs: NOW,
      })
    ).toEqual([]);
    expect(
      stageProgressLines({
        serverId: SERVER,
        panes,
        sessions: { ...idle, observedAtMs: NOW - 10_000 },
        tasks: [nativeTask],
        nowMs: NOW,
      })
    ).toHaveLength(1);
  });
  test('provider-scoped identities remain distinct and update time never reorders them', () => {
    const activities = ['claude', 'codex'].map((agentId, index) => ({
      key: stageSessionKey('shared-asid', agentId),
      asid: 'shared-asid',
      agentId,
      text: `line ${index}`,
      atMs: NOW - index,
    }));
    const before = stageProgressLines({ tasks: [], activities, nowMs: NOW });
    const after = stageProgressLines({
      tasks: [],
      activities: [...activities]
        .reverse()
        .map((activity, index) => ({ ...activity, atMs: NOW + index })),
      nowMs: NOW,
    });
    expect(before).toHaveLength(2);
    expect(after.map((line) => line.key)).toEqual(before.map((line) => line.key));
  });
  test('five subscriptions prefer sessions and remain stable across activity updates', () => {
    const listing = {
      ...sessions,
      sessions: Array.from({ length: 7 }, (_, index) => ({
        ...sessions.sessions[0]!,
        asid: `a${index}`,
        terminal: undefined,
      })),
    };
    const input = { serverId: SERVER, panes, sessions: listing, activeAtMs: {}, nowMs: NOW };
    const first = stageActivitySubjects(input);
    expect(first).toHaveLength(5);
    expect(first.every((subject) => subject.kind === 'session')).toBe(true);
    expect(
      stageActivitySubjects({
        ...input,
        activeAtMs: { [stageSessionKey('a6', 'claude')]: NOW + 1 },
      }).map((subject) => subject.key)
    ).toEqual(first.map((subject) => subject.key));
    const duplicate = {
      ...sessions,
      sessions: [sessions.sessions[0]!, { ...sessions.sessions[0]!, agentId: 'codex' }],
    };
    expect(
      stageActivitySubjects({ ...input, sessions: duplicate }).filter(
        (subject) => subject.kind === 'session'
      )
    ).toHaveLength(2);
  });
  test('old or differently scoped terminal associations cannot suppress a current pane speaker', () => {
    for (const listing of [
      { ...sessions, observedAtMs: panes.checkedAtMs - 1 },
      {
        ...sessions,
        sessions: sessions.sessions.map((session) => ({
          ...session,
          terminal: { sessionId: 'other', paneId: 'p1' },
        })),
      },
    ]) {
      expect(
        stageActivitySubjects({
          serverId: SERVER,
          panes,
          sessions: listing,
          activeAtMs: {},
          nowMs: NOW,
        }).some((subject) => subject.kind === 'pane')
      ).toBe(true);
    }
  });
});
