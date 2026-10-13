import { expect, test } from 'bun:test';
import type { AgentSessionInfo, ToolPart } from '../agent-protocol';
import { subagentPresentation, subagentSessionState } from '../agent-subagent-presentation';
import { descendantsOf, subtaskSummary } from '../agent-subtasks';

const part: ToolPart = {
  type: 'tool',
  id: 'call',
  name: 'subagent',
  state: 'completed',
  input: {},
  metadata: {},
  content: [],
  child_session_id: 'child-exact',
};
const child: AgentSessionInfo = {
  asid: 'child-exact',
  backend_session_id: 'child-exact',
  agent_id: 'any-provider',
  title: 'Review the patch',
  agent_name: 'Reviewer',
  agent_role: 'Security',
  parent_id: 'root',
  model: null,
  status: 'busy',
  updated_ms: 0,
};

test('collaboration operations and activity records retain their distinct meaning', () => {
  const operations = {
    spawnAgent: 'start',
    sendInput: 'send',
    resumeAgent: 'resume',
    wait: 'wait',
    closeAgent: 'close',
    sendMessage: 'send',
    followupTask: 'followup',
    interruptAgent: 'interrupt',
    listAgents: 'list',
  } as const;
  for (const [operation, action] of Object.entries(operations)) {
    expect(subagentPresentation({ ...part, input: { operation } }).action).toBe(action);
  }
  for (const kind of ['started', 'interacted', 'interrupted', 'completed'] as const) {
    const result = subagentPresentation({ ...part, title: '/root/review', metadata: { kind } });
    expect(result.action).toBe(kind);
    expect(result.title).toBe('/root/review');
    expect(result.state).toBeUndefined();
  }
  expect(
    subagentPresentation({ ...part, input: { operation: 'futureOperation' } }).action
  ).toBeUndefined();
});

test('actual child identity, role and supplied task appear without invented progress', () => {
  expect(
    subagentPresentation(
      { ...part, input: { prompt: 'Inspect authentication\nThen report findings' } },
      child
    )
  ).toEqual({
    title: 'Reviewer',
    caption: 'Security · Inspect authentication',
    action: undefined,
    state: 'working',
  });
  expect(subagentPresentation({ ...part, metadata: { agentPath: '/root/security' } }).title).toBe(
    '/root/security'
  );
  expect(subagentPresentation(part).title).toBe('child-exact');
  const unrelated = subagentPresentation(part, { ...child, asid: 'other' });
  expect(unrelated.title).toBe('child-exact');
  expect(unrelated.state).toBeUndefined();
});

test('completed wait and close calls do not imply child completion', () => {
  for (const operation of ['wait', 'closeAgent']) {
    expect(
      subagentPresentation({
        ...part,
        input: { operation },
        metadata: { collabStatus: 'completed' },
      }).state
    ).toBeUndefined();
    expect(
      subagentPresentation(
        { ...part, input: { operation }, metadata: { status: 'completed' } },
        child
      ).state
    ).toBe('working');
  }
  expect(
    subagentPresentation(
      { ...part, metadata: { status: 'completed' } },
      { ...child, status: 'idle' }
    ).state
  ).toBe('idle');
  expect(
    subagentPresentation(
      { ...part, metadata: { status: 'working' } },
      { ...child, status: 'unknown' }
    ).state
  ).toBe('unknown');
});

test('explicit child states survive independently from action results', () => {
  for (const [status, state] of Object.entries({
    starting: 'starting',
    completed: 'completed',
    failed: 'failed',
    interrupted: 'stopped',
    shutdown: 'stopped',
    notFound: 'unavailable',
    future: 'unknown',
  } as const)) {
    expect(subagentPresentation({ ...part, metadata: { status } }).state).toBe(state);
  }
  expect(subagentPresentation(part, undefined, 'working').state).toBe('working');
  expect(
    subagentSessionState({
      ...child,
      runtime: { source: 'terminal', interaction: 'terminal', status: 'blocked' },
    })
  ).toBe('blocked');
});

test('subtask counts use observed runtime state without completing or altering the parent', () => {
  const parent = { ...child, asid: 'root', parent_id: undefined, status: 'busy' as const };
  const starting = {
    ...child,
    status: 'unknown' as const,
    runtime: {
      source: 'native' as const,
      interaction: 'native' as const,
      status: 'starting' as const,
    },
  };
  expect(subtaskSummary(descendantsOf([parent, starting], 'root'))?.running).toBe(1);
  const completed = { ...starting, runtime: { ...starting.runtime, status: 'completed' as const } };
  expect(subtaskSummary(descendantsOf([parent, completed], 'root'))?.running).toBe(0);
  expect(parent.status).toBe('busy');
});
