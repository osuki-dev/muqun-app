import { expect, test } from 'bun:test';
import { AgentEntryPreviews } from '../agent-entry-preview';
import type { TimelineItem } from '../agent-protocol';
const row = (id: string, text = id): TimelineItem => ({
  id,
  message_id: id,
  role: 'assistant',
  ordinal: 0,
  part: { type: 'text', text },
  seq: 0,
  updated_ms: 0,
});
test('recent transcript previews isolate pairings and preserve a bounded contiguous suffix', () => {
  const cache = new AgentEntryPreviews();
  const rows = Array.from({ length: 55 }, (_, i) => row(String(i)));
  cache.remember('pair:a', 's', rows);
  expect(cache.read('pair:a', 's')).toEqual(rows.slice(-40));
  expect(cache.read('pair:b', 's')).toBeUndefined();
  cache.remember('pair:a', 's', [
    rows[0],
    row('large', 't'.repeat(500_000)),
    rows[54],
    row('temp_pending'),
  ]);
  expect(cache.read('pair:a', 's')).toEqual([rows[54]]);
  for (let i = 0; i < 8; i++) cache.remember('pair:a', 'other' + i, [rows[i]]);
  expect(cache.read('pair:a', 's')).toBeUndefined();
});
