import { describe, expect, test } from 'bun:test';

import {
  isTerminalTaskState,
  ledgerTaskBody,
  parseCreatedLedgerTask,
  parseTaskList,
  parseTaskView,
  taskListPath,
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

test('done, failed and cancelled are finished; waiting is not', () => {
  expect(['done', 'failed', 'cancelled'].every((s) => isTerminalTaskState(s as never))).toBe(true);
  expect(isTerminalTaskState('waiting')).toBe(false);
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

describe('the task tree fields', () => {
  test('parent, origin, label, requester and children are read', () => {
    expect(
      parseTaskView({
        task_id: 't2',
        state: 'working',
        kind: 'delegation',
        goal: 'fix the failing test',
        binding: { kind: 'agent_session', agent_id: 'opencode', asid: 'ses_1' },
        updated_ms: 5,
        parent_task_id: 't1',
        origin: 'device',
        label: ' fix test ',
        requested_by: { kind: 'device', id: 'dev-1', name: 'Tablet' },
        children: { total: 2, active: 1, waiting: 1, failed: 0 },
      })
    ).toMatchObject({
      parentTaskId: 't1',
      origin: 'device',
      label: 'fix test',
      requestedBy: { id: 'dev-1', name: 'Tablet' },
      children: { total: 2, active: 1, waiting: 1, failed: 0 },
    });
  });

  test('an older gateway leaves them out, and an unknown origin is dropped', () => {
    const view = parseTaskView({
      task_id: 't',
      state: 'done',
      kind: 'command',
      goal: 'x',
      updated_ms: 1,
      parent_task_id: null,
      origin: 'somewhere',
      label: null,
    });
    expect(Object.keys(view ?? {}).sort()).toEqual(
      ['binding', 'goal', 'kind', 'state', 'taskId', 'updatedMs'].sort()
    );
  });
});

describe('POST /api/tasks', () => {
  test('the body is snake_case and leaves out what was not given', () => {
    expect(ledgerTaskBody({ goal: 'g', agentId: 'opencode', model: 'p/m', label: '  ' })).toEqual({
      goal: 'g',
      agent_id: 'opencode',
      model: 'p/m',
    });
    expect(ledgerTaskBody({ goal: 'g', model: 'p/m', variant: 'high' })).toEqual({
      goal: 'g',
      model: 'p/m',
      variant: 'high',
    });
    // A variant means nothing without the model it belongs to.
    expect(ledgerTaskBody({ goal: 'g', variant: 'high' })).toEqual({ goal: 'g' });
  });

  test('the answer is the task plus the session it opened', () => {
    const created = parseCreatedLedgerTask({
      task_id: 't',
      state: 'working',
      kind: 'delegation',
      goal: 'g',
      binding: { kind: 'agent_session', agent_id: 'opencode', asid: 'ses_9' },
      updated_ms: 1,
      asid: 'ses_9',
    });
    expect(created?.asid).toBe('ses_9');
    expect(created?.task.taskId).toBe('t');
    // A task that failed while being opened has no session, and is still the answer.
    const failed = parseCreatedLedgerTask({ task_id: 't', state: 'failed', updated_ms: 1 });
    expect([failed?.task.taskId, failed?.task.state, failed?.asid]).toEqual([
      't',
      'failed',
      undefined,
    ]);
    expect(parseCreatedLedgerTask({ state: 'failed' })).toBeNull();
  });

  test('a root query is encoded', () => {
    expect(taskListPath({ limit: 100, root: 't 1' })).toBe('/api/tasks?limit=100&root=t%201');
    expect(taskListPath()).toBe('/api/tasks');
  });
});
