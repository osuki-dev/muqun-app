import { describe, expect, test } from 'bun:test';

import type { AgentPart, TimelineItem } from '../agent-protocol';
import { buildTimelineEntries, formatThoughtDuration } from '../agent-reasoning';

function item(id: string, part: AgentPart): TimelineItem {
  return {
    id,
    message_id: 'msg_1',
    role: 'assistant',
    ordinal: 0,
    part,
    seq: 1,
    updated_ms: 1,
  };
}

const thinking = (text: string, durationMs?: number): AgentPart => ({
  type: 'reasoning',
  text,
  ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
});

const text = (body: string): AgentPart => ({ type: 'text', text: body });

const tool: AgentPart = {
  type: 'tool',
  id: 'call_1',
  name: 'edit',
  input: {},
  content: [],
  metadata: {},
  state: 'completed',
};

describe('buildTimelineEntries', () => {
  /**
   * The defect this exists for. OpenCode emits a `reasoning` part per *step*,
   * so one turn drew "Thought · 3.1s", "Thought", "Thought" -- one real pill
   * and two empty ones, which are the protocol's step boundaries showing
   * through rather than anything the reader asked to see.
   */
  test('consecutive reasoning parts are one block', () => {
    const entries = buildTimelineEntries([
      item('r1', thinking('first', 3100)),
      item('r2', thinking('second', 900)),
      item('t1', tool),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'item']);
    expect(entries[0]).toMatchObject({
      kind: 'reasoning',
      run: { text: 'first\n\nsecond', durationMs: 4000, pending: false },
    });
  });

  test('the block keeps the first part&apos;s position and id', () => {
    const entries = buildTimelineEntries([
      item('r1', thinking('a', 10)),
      item('r2', thinking('b', 20)),
      item('x1', text('answer')),
    ]);
    expect(entries[0].key).toBe('r1');
    // Before the text it preceded, which is where the first pill used to be.
    expect(entries[1]).toMatchObject({ kind: 'item', key: 'x1' });
  });

  test('an empty part with a duration still counts, because it is a real step', () => {
    const entries = buildTimelineEntries([item('r1', thinking('   ', 2500)), item('t1', tool)]);
    expect(entries[0]).toMatchObject({
      kind: 'reasoning',
      run: { text: '', durationMs: 2500, pending: false },
    });
  });

  test('an empty finished run in the middle of a message is dropped', () => {
    // Nothing to say and nothing still saying it.
    const entries = buildTimelineEntries([
      item('r1', thinking('')),
      item('t1', tool),
      item('x1', text('done')),
    ]);
    expect(entries.map((entry) => entry.key)).toEqual(['t1', 'x1']);
  });

  test('an empty run at the end is the one still arriving, and is kept', () => {
    const entries = buildTimelineEntries([item('t1', tool), item('r1', thinking(''))]);
    expect(entries[1]).toMatchObject({ kind: 'reasoning', run: { pending: true, text: '' } });
  });

  test('a run that reported a duration is finished even at the end', () => {
    const entries = buildTimelineEntries([item('r1', thinking('done thinking', 1200))]);
    expect(entries[0]).toMatchObject({ kind: 'reasoning', run: { pending: false } });
  });

  test('two separate runs, split by a tool, stay two blocks', () => {
    const entries = buildTimelineEntries([
      item('r1', thinking('before', 100)),
      item('t1', tool),
      item('r2', thinking('after', 200)),
      item('x1', text('answer')),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['reasoning', 'item', 'reasoning', 'item']);
    expect(entries[0]).toMatchObject({ run: { durationMs: 100 } });
    expect(entries[2]).toMatchObject({ run: { durationMs: 200 } });
  });

  test('a message with no reasoning is unchanged', () => {
    const entries = buildTimelineEntries([item('t1', tool), item('x1', text('hi'))]);
    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([
      ['item', 't1'],
      ['item', 'x1'],
    ]);
  });

  test('nothing is nothing', () => {
    expect(buildTimelineEntries([])).toEqual([]);
  });

  test('only some parts reporting a duration still sums the ones that did', () => {
    const entries = buildTimelineEntries([
      item('r1', thinking('a', 500)),
      item('r2', thinking('b')),
      item('t1', tool),
    ]);
    expect(entries[0]).toMatchObject({ run: { durationMs: 500, pending: false } });
  });

  test('a run of only-empty parts at the end is pending, not three pills', () => {
    const entries = buildTimelineEntries([
      item('r1', thinking('')),
      item('r2', thinking('')),
      item('r3', thinking('')),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: 'r1', run: { pending: true } });
  });
});

describe('formatThoughtDuration', () => {
  test('a tenth of a second under ten, whole seconds above it', () => {
    expect(formatThoughtDuration(3100)).toBe('3.1s');
    expect(formatThoughtDuration(9900)).toBe('9.9s');
    expect(formatThoughtDuration(12400)).toBe('12s');
  });

  test('minutes past a minute', () => {
    expect(formatThoughtDuration(65_000)).toBe('1m 05s');
    expect(formatThoughtDuration(3_600_000)).toBe('60m 00s');
  });

  test('zero is zero rather than blank', () => {
    expect(formatThoughtDuration(0)).toBe('0.0s');
  });
});
