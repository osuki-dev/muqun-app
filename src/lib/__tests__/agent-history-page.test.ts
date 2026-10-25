import { expect, test } from 'bun:test';
import { parseEarlierTimelinePage } from '../agent-protocol';

test('filtered empty history pages do not end pagination before older visible rows', () => {
  const pages = [
    { items: [], exhausted: false },
    {
      items: [
        {
          id: 'older',
          message_id: 'm',
          role: 'assistant',
          ordinal: 0,
          seq: 1,
          updated_ms: 1,
          part: { type: 'text', text: 'Earlier history' },
        },
      ],
      exhausted: false,
    },
    { items: [], exhausted: true },
  ].map(parseEarlierTimelinePage);
  expect(pages[0]).toEqual({ items: [], exhausted: false });
  expect(pages[1].items.map((item) => item.id)).toEqual(['older']);
  expect(pages[1].exhausted).toBe(false);
  expect(pages[2].exhausted).toBe(true);
});

test('malformed history responses cannot silently mark all history exhausted', () => {
  for (const response of [
    null,
    {},
    { items: [] },
    { items: null, exhausted: true },
    { items: [], exhausted: 'false' },
  ]) {
    expect(() => parseEarlierTimelinePage(response)).toThrow('Invalid earlier history page');
  }
});
