import { describe, expect, test } from 'bun:test';

import type { FormRequest, PermissionRequest } from '../agent-protocol';
import type { HomeAttentionSnapshot } from '../home-attention';
import type { ServerAgent, ServerAgentsSnapshot } from '../server-agents';
import {
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

  test("the dock's pane line counts when it is newer", () => {
    const line = stageProgress({
      tasks: [task('t1', { progress: 'running tests…', updatedMs: NOW - 4_000 })],
      panes: mirror([agent('p1')]),
      paneLine: { paneId: 'p1', text: 'All 42 tests pass.', atMs: NOW - 100 },
      nowMs: NOW,
    });
    expect(line).toMatchObject({ agentLabel: 'claude', text: 'All 42 tests pass.' });
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
