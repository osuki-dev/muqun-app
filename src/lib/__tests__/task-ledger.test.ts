import { describe, expect, test } from 'bun:test';

import {
  TASK_LEDGER_CAPABILITY,
  hasTaskLedger,
  isTerminalTaskState,
  parseTaskEvent,
  parseTaskList,
  parseTaskView,
} from '../task-ledger';

describe('parseTaskView', () => {
  test('reads a pane-bound command with snake_case keys', () => {
    expect(
      parseTaskView({
        task_id: 't1',
        state: 'failed',
        kind: 'command',
        goal: 'cargo test',
        summary: 'exit 3',
        exit_code: 3,
        binding: { kind: 'pane', session_id: 's', pane_id: 'p', tab_id: 'tb', shell_pid: 42 },
        updated_ms: 1000,
      })
    ).toEqual({
      taskId: 't1',
      state: 'failed',
      kind: 'command',
      goal: 'cargo test',
      summary: 'exit 3',
      exitCode: 3,
      binding: { kind: 'pane', sessionId: 's', paneId: 'p', tabId: 'tb', shellPid: 42 },
      updatedMs: 1000,
    });
  });

  test('reads the agent_session and none bindings', () => {
    const base = { task_id: 't', state: 'working', kind: 'delegation', goal: 'g', updated_ms: 1 };
    expect(
      parseTaskView({ ...base, binding: { kind: 'agent_session', agent_id: 'a', asid: 'x' } })
        ?.binding
    ).toEqual({ kind: 'agent_session', agentId: 'a', asid: 'x' });
    expect(parseTaskView({ ...base, binding: { kind: 'none' } })?.binding).toEqual({
      kind: 'none',
    });
    expect(parseTaskView(base)?.binding).toEqual({ kind: 'none' });
  });

  test('an unknown state or a missing id is not a task', () => {
    const ok = { task_id: 't', state: 'working', kind: 'command', goal: 'g', updated_ms: 1 };
    expect(parseTaskView({ ...ok, state: 'exploding' })).toBeNull();
    expect(parseTaskView({ ...ok, task_id: undefined })).toBeNull();
    expect(parseTaskView(null)).toBeNull();
  });
});

describe('parseTaskEvent', () => {
  test('reads an event and keeps from/note optional', () => {
    expect(
      parseTaskEvent({
        task_id: 't',
        seq: 2,
        at_ms: 5,
        from: 'working',
        to: 'done',
        source: 'mcp',
        note: 'n',
      })
    ).toEqual({
      taskId: 't',
      seq: 2,
      atMs: 5,
      from: 'working',
      to: 'done',
      source: 'mcp',
      note: 'n',
    });
    expect(parseTaskEvent({ task_id: 't', seq: 1, at_ms: 5, to: 'queued', source: 'gw' })).toEqual({
      taskId: 't',
      seq: 1,
      atMs: 5,
      to: 'queued',
      source: 'gw',
    });
    expect(
      parseTaskEvent({ task_id: 't', seq: 1, at_ms: 5, to: 'bogus', source: 'gw' })
    ).toBeNull();
  });
});

test('terminal states and the capability', () => {
  expect(['done', 'failed', 'cancelled'].every((s) => isTerminalTaskState(s as never))).toBe(true);
  expect(isTerminalTaskState('waiting')).toBe(false);
  expect(hasTaskLedger([TASK_LEDGER_CAPABILITY])).toBe(true);
  expect(hasTaskLedger(['ws_events'])).toBe(false);
  expect(hasTaskLedger(undefined)).toBe(false);
});

describe('parseTaskList', () => {
  test('a body without a tasks array is a failed read, not an empty list', () => {
    expect(parseTaskList({})).toBeNull();
    expect(parseTaskList({ tasks: 'x' })).toBeNull();
    expect(parseTaskList(null)).toBeNull();
  });

  test('an empty tasks array is a real empty list', () => {
    expect(parseTaskList({ tasks: [] })).toEqual([]);
  });
});
