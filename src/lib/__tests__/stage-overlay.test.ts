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
      key: 'session:a9',
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
      key: 'session:s1',
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
        panes: mirror([agent('p1')], NOW),
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
