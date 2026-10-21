import { describe, expect, test } from 'bun:test';

import type { AgentSessionSnapshot, TimelineItem } from '@/lib/agent-protocol';
import type { HomeContinueEntry } from '@/lib/home-continue';
import {
  applyHomeThreadEvent,
  EMPTY_HOME_THREAD_LIVE,
  homeThreadEnded,
  homeThreadLiveFromSnapshot,
  homeThreadResolved,
  homeThreadSendPlan,
  homeThreadState,
  homeThreadTargetFromEntry,
  homeThreadTargetFromTask,
  homeThreadTask,
  homeThreadTurns,
  parseHomeThreads,
  type HomeThreadPane,
  type HomeThreadSession,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import type { ServerAgentsSnapshot } from '@/lib/server-agents';
import type { TaskView } from '@/lib/task-ledger';

const SESSION: HomeThreadSession = {
  kind: 'session',
  serverId: 'a',
  sessionId: 'herdr',
  asid: 'ses_1',
  agentId: 'opencode',
  title: 'Review',
  setAtMs: 100,
};
const PANE: HomeThreadPane = {
  kind: 'pane',
  serverId: 'a',
  sessionId: 'herdr',
  paneId: 'p1',
  instanceId: 'inst-1',
  title: 'Codex',
  setAtMs: 100,
};
const NO_FEATURES = { inbox: false, steering: false };

function task(overrides: Partial<TaskView>): TaskView {
  return {
    taskId: 't1',
    state: 'working',
    kind: 'delegation',
    goal: 'Do it',
    binding: { kind: 'none' },
    updatedMs: 1,
    ...overrides,
  };
}

function text(id: string, role: 'user' | 'assistant', body: string, order = id): TimelineItem {
  return {
    id,
    message_id: order,
    role,
    ordinal: 0,
    part: { type: 'text', text: body },
    seq: 1,
    updated_ms: 1,
  };
}

function snapshot(overrides: Partial<AgentSessionSnapshot>): AgentSessionSnapshot {
  return { info: null, timeline: [], permissions: [], forms: [], inbox: [], seq: 0, ...overrides };
}

describe('what Send does', () => {
  test('no target creates, as Home always did', () => {
    expect(homeThreadSendPlan({ target: undefined, features: NO_FEATURES })).toEqual({
      kind: 'create',
    });
  });

  test('an idle session takes a plain follow-up prompt', () => {
    expect(
      homeThreadSendPlan({ target: SESSION, live: { status: 'idle' }, features: NO_FEATURES })
    ).toEqual({ kind: 'session', sessionId: 'herdr', asid: 'ses_1' });
  });

  test('a running session is steered where the agent can take it, refused where it cannot', () => {
    expect(
      homeThreadSendPlan({
        target: SESSION,
        live: { status: 'busy' },
        features: { inbox: false, steering: true },
      })
    ).toMatchObject({ kind: 'session', delivery: 'steer' });
    expect(
      homeThreadSendPlan({ target: SESSION, live: { status: 'busy' }, features: NO_FEATURES })
    ).toEqual({ kind: 'busy' });
  });

  test('a session that lives in a terminal is continued there, not prompted natively', () => {
    expect(
      homeThreadSendPlan({
        target: SESSION,
        live: { status: 'idle', interaction: 'terminal' },
        features: NO_FEATURES,
      })
    ).toEqual({ kind: 'terminal' });
  });

  test('pills changed since targeting are switched on the session; unchanged ones are not', () => {
    const target = {
      ...SESSION,
      pills: { mode: 'build', model: { provider_id: 'p', model_id: 'm1' } },
    };
    expect(
      homeThreadSendPlan({
        target,
        features: NO_FEATURES,
        pills: { mode: 'plan', model: { provider_id: 'p', model_id: 'm1' } },
      })
    ).toEqual({ kind: 'session', sessionId: 'herdr', asid: 'ses_1', switchMode: 'plan' });
    expect(
      homeThreadSendPlan({ target: SESSION, features: NO_FEATURES, pills: { mode: 'plan' } })
    ).toEqual({ kind: 'session', sessionId: 'herdr', asid: 'ses_1' });
  });

  test('a pane goes to its agent; a task without a binding yet is still starting', () => {
    expect(homeThreadSendPlan({ target: PANE, features: NO_FEATURES })).toEqual({
      kind: 'pane',
      sessionId: 'herdr',
      paneId: 'p1',
    });
    const pending: HomeThreadTarget = {
      kind: 'task',
      serverId: 'a',
      taskId: 't1',
      title: 'x',
      setAtMs: 1,
    };
    expect(homeThreadSendPlan({ target: pending, task: task({}), features: NO_FEATURES })).toEqual({
      kind: 'starting',
    });
    expect(
      homeThreadSendPlan({
        target: pending,
        task: task({ binding: { kind: 'agent_session', agentId: 'opencode', asid: 'ses_9' } }),
        features: NO_FEATURES,
      })
    ).toEqual({ kind: 'session', sessionId: 'herdr', asid: 'ses_9' });
    expect(
      homeThreadSendPlan({
        target: pending,
        task: task({ binding: { kind: 'peer', peerId: 'x', remoteTaskId: '' } }),
        features: NO_FEATURES,
      })
    ).toEqual({ kind: 'elsewhere' });
  });
});

describe('targets', () => {
  test('a card for an agent session or an agent pane is a conversation; a shell is not', () => {
    const entry = (destination: HomeContinueEntry['destination'], agentLabel?: string) =>
      ({
        key: 'k',
        title: 'T',
        atMs: 1,
        destination,
        ...(agentLabel ? { agentLabel } : {}),
      }) as HomeContinueEntry;
    expect(
      homeThreadTargetFromEntry(
        entry({
          type: 'agent-session',
          target: {
            kind: 'agent-session',
            serverId: 'a',
            sessionId: 'herdr',
            directory: '/w',
            asid: 's',
          },
        }),
        5
      )
    ).toMatchObject({ kind: 'session', serverId: 'a', asid: 's', directory: '/w', setAtMs: 5 });
    expect(homeThreadTargetFromEntry(entry({ type: 'pane', serverId: 'a', paneId: 'p' }), 5)).toBe(
      null
    );
    const panes: ServerAgentsSnapshot = {
      serverId: 'a',
      sessionId: 'herdr',
      checkedAtMs: 1,
      agents: [
        { id: 'x', name: 'codex', status: 'idle', hasAgent: true, paneId: 'p', instanceId: 'i' },
      ],
    };
    expect(
      homeThreadTargetFromEntry(entry({ type: 'pane', serverId: 'a', paneId: 'p' }), 5, () => panes)
    ).toMatchObject({ kind: 'pane', paneId: 'p', sessionId: 'herdr', instanceId: 'i' });
    expect(
      homeThreadTargetFromEntry(
        entry({ type: 'recent', target: { kind: 'ssh-host', hostId: 'h' } }),
        5
      )
    ).toBe(null);
  });

  test('a task becomes the session or pane it is bound to, keeping its id', () => {
    const pending = homeThreadTargetFromTask('a', task({}), 'Goal', 1);
    expect(pending).toMatchObject({ kind: 'task', taskId: 't1' });
    const bound = homeThreadResolved(
      { ...pending, lastSent: 'hi' },
      task({ binding: { kind: 'pane', sessionId: 'herdr', paneId: 'p2', agentId: 'codex' } })
    );
    expect(bound).toMatchObject({ kind: 'pane', paneId: 'p2', taskId: 't1', lastSent: 'hi' });
    expect(homeThreadResolved(SESSION, task({}))).toBe(SESSION);
  });

  test('a target finds its task by id, else by the session or pane it runs in', () => {
    const tasks = [
      task({
        taskId: 'old',
        updatedMs: 1,
        binding: { kind: 'agent_session', agentId: 'o', asid: 'ses_1' },
      }),
      task({
        taskId: 'new',
        updatedMs: 2,
        binding: { kind: 'agent_session', agentId: 'o', asid: 'ses_1' },
      }),
    ];
    expect(homeThreadTask(SESSION, tasks)?.taskId).toBe('new');
    expect(homeThreadTask({ ...SESSION, taskId: 'old' }, tasks)?.taskId).toBe('old');
    expect(homeThreadTask(PANE, tasks)).toBeUndefined();
  });

  test('persisted targets are read back and malformed ones dropped', () => {
    const stored = JSON.stringify({
      a: SESSION,
      b: { ...PANE, serverId: 'b' },
      c: { kind: 'session' },
      d: SESSION,
    });
    expect(Object.keys(parseHomeThreads(stored))).toEqual(['a', 'b']);
    expect(parseHomeThreads('not json')).toEqual({});
  });
});

describe('when a conversation has ended', () => {
  test('gone, not found or its agent removed ends a session; idle and done do not', () => {
    expect(homeThreadEnded(SESSION, { goneSession: true })).toBe(true);
    expect(homeThreadEnded(SESSION, { notFound: true })).toBe(true);
    expect(homeThreadEnded(SESSION, { agentIds: ['codex'] })).toBe(true);
    expect(homeThreadEnded(SESSION, { agentIds: ['opencode'] })).toBe(false);
    expect(homeThreadEnded(SESSION, { task: task({ state: 'done' }) })).toBe(false);
    expect(homeThreadEnded(SESSION, { task: task({ state: 'cancelled' }) })).toBe(true);
  });

  test('a pane ends when a newer mirror lacks its agent or shows another instance', () => {
    const mirror = (
      agents: ServerAgentsSnapshot['agents'],
      checkedAtMs = 200
    ): ServerAgentsSnapshot => ({
      serverId: 'a',
      sessionId: 'herdr',
      checkedAtMs,
      agents,
    });
    const row = { id: 'x', name: 'codex', status: 'idle' as const, hasAgent: true, paneId: 'p1' };
    expect(homeThreadEnded(PANE, { panes: mirror([{ ...row, instanceId: 'inst-1' }]) })).toBe(
      false
    );
    expect(homeThreadEnded(PANE, { panes: mirror([{ ...row, instanceId: 'inst-2' }]) })).toBe(true);
    expect(homeThreadEnded(PANE, { panes: mirror([{ ...row, hasAgent: false }]) })).toBe(true);
    expect(homeThreadEnded(PANE, { panes: mirror([]) })).toBe(true);
    // A mirror from before the target was set says nothing about it.
    expect(homeThreadEnded(PANE, { panes: mirror([], 50) })).toBe(false);
  });
});

describe('the live strip', () => {
  test('shows the reader’s last message and the reply after it, as it streams', () => {
    let live = homeThreadLiveFromSnapshot(
      snapshot({
        timeline: [text('u1', 'user', 'first', 'm1'), text('a1', 'assistant', 'answer one', 'm2')],
      })
    );
    expect(homeThreadTurns(live)).toEqual({
      mine: { id: 'u1', text: 'first' },
      reply: { id: 'a1', text: 'answer one' },
    });
    live = applyHomeThreadEvent(live, {
      type: 'agent.timeline.upsert',
      asid: 's',
      seq: 2,
      items: [text('u2', 'user', 'second', 'm3')],
    });
    expect(homeThreadTurns(live)).toEqual({ mine: { id: 'u2', text: 'second' } });
    live = applyHomeThreadEvent(live, {
      type: 'agent.timeline.upsert',
      asid: 's',
      seq: 3,
      items: [text('a2', 'assistant', 'part', 'm4')],
    });
    live = applyHomeThreadEvent(live, {
      type: 'agent.timeline.upsert',
      asid: 's',
      seq: 4,
      items: [text('a2', 'assistant', 'partial reply', 'm4')],
    });
    expect(homeThreadTurns(live).reply).toEqual({ id: 'a2', text: 'partial reply' });
  });

  test('requests come and go with their events', () => {
    const request = {
      id: 'perm',
      asid: 's',
      action: 'bash',
      resources: [],
      save: [],
      prompt: 'run tests',
      options: [],
    };
    let live = applyHomeThreadEvent(EMPTY_HOME_THREAD_LIVE, {
      type: 'agent.permission.pending',
      asid: 's',
      seq: 1,
      request,
    });
    expect(homeThreadState({ live })).toBe('needs-you');
    live = applyHomeThreadEvent(live, {
      type: 'agent.permission.resolved',
      asid: 's',
      seq: 2,
      request_id: 'perm',
    });
    expect(live.permissions).toEqual([]);
  });

  test('idle is never reported as done; a running task is working', () => {
    expect(homeThreadState({ live: { ...EMPTY_HOME_THREAD_LIVE, status: 'idle' } })).toBe('idle');
    expect(homeThreadState({ live: { ...EMPTY_HOME_THREAD_LIVE, status: 'busy' } })).toBe(
      'working'
    );
    expect(homeThreadState({ task: { state: 'done' } })).toBe('idle');
    expect(homeThreadState({ task: { state: 'working' } })).toBe('working');
    expect(homeThreadState({ task: { state: 'waiting' } })).toBe('needs-you');
    expect(homeThreadState({ pane: { status: 'blocked' } })).toBe('needs-you');
    expect(homeThreadState({ unbound: true })).toBe('starting');
  });
});
