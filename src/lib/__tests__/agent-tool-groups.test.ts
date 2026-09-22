import { describe, expect, test } from 'bun:test';

import type { TimelineEntry } from '../agent-reasoning';
import type { TimelineItem, ToolPart } from '../agent-protocol';
import { groupRoutineToolEntries, isRoutineToolEntry } from '../agent-tool-groups';

function tool(
  id: string,
  name: string,
  state: ToolPart['state'] = 'completed',
  metadata: Record<string, unknown> = {}
): TimelineEntry {
  const item: TimelineItem = {
    id,
    message_id: 'msg_1',
    role: 'assistant',
    ordinal: 0,
    part: { type: 'tool', id, name, input: {}, content: [], metadata, state },
    seq: 1,
    updated_ms: 1,
  };
  return { kind: 'item', key: id, item };
}

function text(id: string): TimelineEntry {
  return {
    kind: 'item',
    key: id,
    item: {
      id,
      message_id: 'msg_1',
      role: 'assistant',
      ordinal: 0,
      part: { type: 'text', text: id },
      seq: 1,
      updated_ms: 1,
    },
  };
}

describe('routine tool grouping', () => {
  test('adjacent completed inspection and successful shell calls share one compact run', () => {
    const entries = [
      tool('grep', 'grep'),
      tool('read', 'read'),
      tool('shell', 'shell', 'completed', { exit: 0 }),
    ];
    const grouped = groupRoutineToolEntries(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe('tool-group');
    expect(grouped[0].key).toBe('tool-group:grep');
    expect(
      grouped[0].kind === 'tool-group' ? grouped[0].entries.map((entry) => entry.key) : []
    ).toEqual(['grep', 'read', 'shell']);
  });

  test('a singleton keeps the original tool card', () => {
    const entry = tool('grep', 'grep');
    expect(groupRoutineToolEntries([entry])).toEqual([
      { kind: 'entry', key: 'grep', entry, sourceIndex: 0 },
    ]);
  });

  test('prose and consequential tools split routine runs without changing order', () => {
    const entries = [
      tool('a', 'grep'),
      tool('b', 'read'),
      text('answer'),
      tool('edit', 'patch'),
      tool('c', 'glob'),
      tool('d', 'shell', 'completed', { exit: 0 }),
    ];
    const grouped = groupRoutineToolEntries(entries);
    expect(grouped.map((entry) => entry.kind)).toEqual([
      'tool-group',
      'entry',
      'entry',
      'tool-group',
    ]);
    expect(
      grouped.flatMap((entry) =>
        entry.kind === 'tool-group'
          ? entry.entries.map((toolEntry) => toolEntry.key)
          : [entry.entry.key]
      )
    ).toEqual(['a', 'b', 'answer', 'edit', 'c', 'd']);
  });

  test('active, failed, timed-out and non-zero shell calls never disappear into a group', () => {
    const entries = [
      tool('running', 'grep', 'running'),
      tool('failed', 'read', 'failed'),
      tool('exit', 'shell', 'completed', { exit: 1 }),
      tool('timeout', 'shell', 'completed', { exit: 143, timeout: true }),
    ];
    expect(entries.some(isRoutineToolEntry)).toBe(false);
    expect(groupRoutineToolEntries(entries).map((entry) => entry.kind)).toEqual([
      'entry',
      'entry',
      'entry',
      'entry',
    ]);
  });

  test('edits, questions, subagents, todos, skills, browsers and unknown tools stay standalone', () => {
    for (const name of [
      'edit',
      'write',
      'patch',
      'question',
      'subagent',
      'todowrite',
      'skill',
      'browser',
      'future_mcp_tool',
    ]) {
      expect(isRoutineToolEntry(tool(name, name))).toBe(false);
    }
  });

  test('a growing run keeps the key of its first call', () => {
    const before = groupRoutineToolEntries([tool('a', 'grep'), tool('b', 'read')]);
    const after = groupRoutineToolEntries([
      tool('a', 'grep'),
      tool('b', 'read'),
      tool('c', 'shell', 'completed', { exit: 0 }),
    ]);
    expect(after[0].key).toBe(before[0].key);
  });
});
