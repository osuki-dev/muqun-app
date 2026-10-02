import { expect, test } from 'bun:test';

import type { AgentRunStatus, AgentSessionInfo } from '../agent-protocol';
import {
  applySubtaskBlockEvent,
  descendantsOf,
  subtaskSummary,
  type SubtaskBlocks,
} from '../agent-subtasks';

function session(
  asid: string,
  parent?: string,
  status: AgentRunStatus = 'idle',
  extra: Partial<AgentSessionInfo> = {}
): AgentSessionInfo {
  return {
    asid,
    backend_session_id: asid,
    agent_id: 'opencode',
    title: asid,
    model: null,
    status,
    updated_ms: 0,
    ...(parent ? { parent_id: parent } : {}),
    ...extra,
  };
}

const ids = (nodes: ReturnType<typeof descendantsOf>) =>
  nodes.map((node) => `${node.session.asid}@${node.depth}`);

test('a session without children has no subtasks', () => {
  const sessions = [session('root'), session('other'), session('x', 'other')];
  expect(descendantsOf(sessions, 'root')).toEqual([]);
  expect(subtaskSummary(descendantsOf(sessions, 'root'))).toBeNull();
  expect(descendantsOf(sessions, undefined)).toEqual([]);
});

test('descendants are depth-first, a parent before its children', () => {
  const sessions = [
    session('root'),
    session('a', 'root'),
    session('b', 'root'),
    session('a1', 'a'),
    session('a1x', 'a1'),
    session('b1', 'b'),
    session('elsewhere', 'other-root'),
  ];
  expect(ids(descendantsOf(sessions, 'root'))).toEqual(['a@1', 'a1@2', 'a1x@3', 'b@1', 'b1@2']);
  // From a child, only its own subtree.
  expect(ids(descendantsOf(sessions, 'a'))).toEqual(['a1@1', 'a1x@2']);
});

test('running siblings come first; deleted sessions are left out', () => {
  const sessions = [
    session('root'),
    session('done', 'root'),
    session('live', 'root', 'busy'),
    session('gone', 'root', 'busy', { deleted: true }),
  ];
  expect(ids(descendantsOf(sessions, 'root'))).toEqual(['live@1', 'done@1']);
});

test('counts running subtasks at every depth', () => {
  const sessions = [
    session('root'),
    session('a', 'root', 'busy'),
    session('a1', 'a', 'retry'),
    session('b', 'root', 'idle'),
    session('c', 'root', 'failed'),
  ];
  expect(subtaskSummary(descendantsOf(sessions, 'root'))).toEqual({
    total: 4,
    running: 2,
    blocked: 0,
    kind: 'running',
  });
  expect(subtaskSummary(descendantsOf([session('r'), session('x', 'r')], 'r'))).toEqual({
    total: 1,
    running: 0,
    blocked: 0,
    kind: 'idle',
  });
});

test('a subtask waiting on the reader takes precedence over running ones', () => {
  const sessions = [
    session('root'),
    session('a', 'root', 'busy'),
    session('b', 'root', 'busy'),
    session('c', 'root', 'busy'),
  ];
  const blocks: SubtaskBlocks = { b: ['perm-1'] };
  expect(subtaskSummary(descendantsOf(sessions, 'root'), blocks)).toEqual({
    total: 3,
    running: 2,
    blocked: 1,
    kind: 'blocked',
  });
});

test('cycles, self-parents and unknown parents never loop', () => {
  const sessions = [
    session('root', 'c'),
    session('a', 'root'),
    session('b', 'a'),
    session('c', 'b'),
    session('self', 'self'),
    session('orphan', 'missing'),
    // The same session listed twice is one subtask.
    session('a', 'root'),
  ];
  expect(ids(descendantsOf(sessions, 'root'))).toEqual(['a@1', 'b@2', 'c@3']);
  expect(descendantsOf(sessions, 'self')).toEqual([]);
  expect(ids(descendantsOf(sessions, 'missing'))).toEqual(['orphan@1']);
});

test('requests open and close per session; a stopped session waits on nothing', () => {
  let blocks: SubtaskBlocks = {};
  const pending = {
    type: 'agent.permission.pending',
    asid: 'a',
    seq: 1,
    request: { id: 'p1' },
  } as Parameters<typeof applySubtaskBlockEvent>[1];
  blocks = applySubtaskBlockEvent(blocks, pending);
  expect(blocks).toEqual({ a: ['p1'] });
  expect(applySubtaskBlockEvent(blocks, pending)).toBe(blocks);
  blocks = applySubtaskBlockEvent(blocks, {
    type: 'agent.form.pending',
    asid: 'a',
    seq: 2,
    request: { id: 'f1', asid: 'a', title: '', fields: [] },
  });
  expect(blocks).toEqual({ a: ['p1', 'f1'] });
  blocks = applySubtaskBlockEvent(blocks, {
    type: 'agent.permission.resolved',
    asid: 'a',
    seq: 3,
    request_id: 'p1',
  });
  expect(blocks).toEqual({ a: ['f1'] });
  expect(
    applySubtaskBlockEvent(blocks, {
      type: 'agent.status.changed',
      asid: 'a',
      seq: 4,
      status: 'busy',
    })
  ).toBe(blocks);
  blocks = applySubtaskBlockEvent(blocks, {
    type: 'agent.status.changed',
    asid: 'a',
    seq: 5,
    status: 'idle',
  });
  expect(blocks).toEqual({});
});
