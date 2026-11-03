import { describe, expect, test } from 'bun:test';
import { drawnRowKey, reconcileAgentSnapshotPending } from '../agent-timeline-upsert';
import type { TimelineItem } from '@/lib/agent-protocol';

const row = (
  id: string,
  text: string,
  role: TimelineItem['role'] = 'user',
  extra: Partial<TimelineItem> = {}
): TimelineItem => ({
  id,
  message_id: id,
  role,
  ordinal: 0,
  seq: 1,
  updated_ms: 1,
  part: { type: 'text', text },
  ...extra,
});

describe('reconcileAgentSnapshotPending', () => {
  // A replacement snapshot must not re-key rows the reader is looking at:
  // every key changing at once is what blanked the transcript on send.
  const cases: {
    name: string;
    previous: TimelineItem[];
    snapshot: TimelineItem[];
    keys: string[];
  }[] = [
    {
      name: 'a re-id of the same conversation keeps every drawn key, in order',
      previous: [row('u1', 'hi'), row('a1', 'hello', 'assistant'), row('u2', 'ok')],
      snapshot: [row('x1', 'hi'), row('a1', 'hello', 'assistant'), row('x2', 'ok')],
      keys: ['u1', 'a1', 'u2'],
    },
    {
      name: 'repeated identical rows map to their previous counterparts in order',
      previous: [row('u1', 'ok'), row('u2', 'ok'), row('u3', 'ok')],
      snapshot: [row('x1', 'ok'), row('x2', 'ok')],
      keys: ['u1', 'u2'],
    },
    {
      name: 'a row that says something else is a new row',
      previous: [row('u1', 'hi'), row('u2', 'bye')],
      snapshot: [row('x1', 'hi'), row('x2', 'bye, edited')],
      keys: ['u1', 'x2'],
    },
    {
      name: 'a row matched by id keeps the key it was acknowledged under',
      previous: [row('m1', 'hi', 'user', { row_key: 'temp_usr_1' })],
      snapshot: [row('m1', 'hi')],
      keys: ['temp_usr_1'],
    },
    {
      name: 'an id the snapshot still carries is never given away to a lookalike',
      previous: [row('u1', 'hi')],
      snapshot: [row('x1', 'hi'), row('u1', 'something new')],
      keys: ['x1', 'u1'],
    },
    {
      name: 'an optimistic row is acknowledged by the upsert, not matched as history',
      previous: [row('u1', 'hi'), row('temp_usr_9', 'sent', 'user', { seq: 1 })],
      snapshot: [row('x1', 'hi'), row('m9', 'sent', 'user', { seq: 2 })],
      keys: ['u1', 'temp_usr_9'],
    },
  ];
  // Rows sort by their order key; a timeline's rows carry one in sequence.
  const ordered = (rows: TimelineItem[]) =>
    rows.map((item, index) => ({ ...item, order: String(index).padStart(4, '0') }));
  test.each(cases)('$name', ({ previous, snapshot, keys }) => {
    const next = reconcileAgentSnapshotPending(ordered(previous), ordered(snapshot));
    expect(next.map(drawnRowKey)).toEqual(keys);
    expect(new Set(next.map(drawnRowKey)).size).toBe(next.length);
  });

  test('an unchanged row keeps the object it was drawn from across a snapshot', () => {
    const drawn = ordered([row('u1', 'hi'), row('a1', 'hello', 'assistant')]);
    const fresh = ordered([row('u1', 'hi'), row('a1', 'hello', 'assistant')]);
    const next = reconcileAgentSnapshotPending(drawn, fresh);
    expect(next[0]).toBe(drawn[0]);
    expect(next[1]).toBe(drawn[1]);
  });

  test('returns the snapshot rows themselves when nothing is re-keyed', () => {
    const snapshot = ordered([row('u1', 'hi'), row('a1', 'hello', 'assistant')]);
    const next = reconcileAgentSnapshotPending(ordered([row('u1', 'hi')]), snapshot);
    expect(next.map((item) => item.id)).toEqual(['u1', 'a1']);
    expect(next.every((item) => item.row_key === undefined)).toBe(true);
  });
});
