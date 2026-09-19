import { describe, expect, test } from 'bun:test';
import { AGENT_STREAM_BATCH_MS, createAgentStreamBatch } from '../agent-stream-batch';
import type { AgentDomainEvent, TimelineItem } from '../agent-protocol';
import { upsertTimelineItems } from '../agent-timeline-upsert';

function item(id: string, seq: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id,
    message_id: id,
    ordinal: 0,
    role: 'assistant',
    part: { type: 'text', text: `revision ${seq}` },
    seq,
    updated_ms: seq,
    ...extra,
  };
}
function update(items: TimelineItem[], asid = 'session'): AgentDomainEvent {
  return {
    type: 'agent.timeline.upsert',
    asid,
    seq: Math.max(...items.map((row) => row.seq)),
    items,
  };
}

describe('stream presentation batches', () => {
  test('200 revisions of two parts produce one update with the complete latest values', () => {
    const events: AgentDomainEvent[] = [];
    const batch = createAgentStreamBatch((event) => events.push(event));
    for (let seq = 1; seq <= 100; seq++) {
      batch.push(update([item('a', seq), item('b', seq)]));
    }
    expect(events).toHaveLength(0);
    batch.flush();
    expect(events).toEqual([update([item('a', 100), item('b', 100)])]);
  });

  test('completion and deletion flush pending text before their immediate delivery', () => {
    const events: AgentDomainEvent[] = [];
    const batch = createAgentStreamBatch((event) => events.push(event));
    const removed: AgentDomainEvent = {
      type: 'agent.timeline.removed',
      asid: 'session',
      seq: 3,
      ids: ['a'],
    };
    const idle: AgentDomainEvent = {
      type: 'agent.status.changed',
      asid: 'session',
      seq: 4,
      status: 'idle',
    };
    batch.push(update([item('a', 2)]));
    batch.push(removed);
    batch.push(idle);
    batch.flush();
    expect(events).toEqual([update([item('a', 2)]), removed, idle]);
  });

  test('different sessions never share a batch', () => {
    const events: AgentDomainEvent[] = [];
    const batch = createAgentStreamBatch((event) => events.push(event));
    batch.push(update([item('a', 1)], 'one'));
    batch.push(update([item('a', 2)], 'two'));
    batch.flush();
    expect(events).toEqual([update([item('a', 1)], 'one'), update([item('a', 2)], 'two')]);
  });

  test('a stale replay does not replace a newer buffered revision', () => {
    const events: AgentDomainEvent[] = [];
    const batch = createAgentStreamBatch((event) => events.push(event));
    batch.push(update([item('a', 9)]));
    batch.push(update([item('a', 5)]));
    batch.flush();
    expect(events).toEqual([update([item('a', 9)])]);
  });

  test('the final partial batch is delivered by the timer; leaving cancels delivery', async () => {
    const events: AgentDomainEvent[] = [];
    const batch = createAgentStreamBatch((event) => events.push(event));
    batch.push(update([item('a', 1)]));
    await new Promise((resolve) => setTimeout(resolve, AGENT_STREAM_BATCH_MS + 30));
    expect(events).toHaveLength(1);
    batch.push(update([item('a', 2)]));
    batch.cancel();
    await new Promise((resolve) => setTimeout(resolve, AGENT_STREAM_BATCH_MS + 30));
    expect(events).toHaveLength(1);
  });
});

describe('timeline revision merge', () => {
  test('updating a part preserves history identities and does not mutate the previous snapshot', () => {
    const previous = [item('a', 1), item('b', 1)];
    const next = upsertTimelineItems(previous, [item('b', 2)]);
    expect(next[0]).toBe(previous[0]);
    expect(next[1].seq).toBe(2);
    expect(previous[1].seq).toBe(1);
  });

  test('catch-up revisions win over older buffered output', () => {
    const previous = [item('a', 9)];
    expect(upsertTimelineItems(previous, [item('a', 5)])).toBe(previous);
  });

  test('new rows and changed ordinals are sorted, repeated ids are not duplicated', () => {
    const previous = [item('b', 1), item('c', 1)];
    const next = upsertTimelineItems(previous, [item('a', 1), item('a', 2)]);
    expect(next.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(next[0].seq).toBe(2);
    const parts = [
      item('a', 1, { message_id: 'm', ordinal: 0 }),
      item('b', 1, { message_id: 'm', ordinal: 1 }),
    ];
    expect(
      upsertTimelineItems(parts, [item('a', 2, { message_id: 'm', ordinal: 2 })]).map(
        (row) => row.id
      )
    ).toEqual(['b', 'a']);
  });

  test('an optimistic acknowledgement keeps its visual identity and order', () => {
    const optimistic = item('temp_user', 0, {
      role: 'user',
      order: 'b',
      part: { type: 'text', text: 'hello' },
    });
    const acknowledged = item('z', 2, { role: 'user', part: { type: 'text', text: 'hello' } });
    const next = upsertTimelineItems([item('a', 1), optimistic, item('c', 1)], [acknowledged]);
    expect(next.map((row) => row.id)).toEqual(['a', 'z', 'c']);
    expect(next[1].row_key).toBe('temp_user');
    expect(next[1].order).toBe('b');
  });
});
