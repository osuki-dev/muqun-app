import { describe, expect, test } from 'bun:test';
import { windowStartForSnapshot } from '../agent-timeline-window';
import type { TimelineItem } from '@/lib/agent-protocol';

const item = (id: string): TimelineItem => ({
  id,
  message_id: 'message',
  role: 'assistant',
  ordinal: 0,
  seq: 1,
  updated_ms: 1,
  part: { type: 'text', text: id },
});

describe('windowStartForSnapshot', () => {
  test('moves the window with its existing top-row anchor', () => {
    expect(
      windowStartForSnapshot(
        [item('first'), item('anchor'), item('last')],
        1,
        [item('new-first'), item('anchor'), item('last')],
        40
      )
    ).toBe(1);
  });

  test('falls back to the newest page when the anchor is absent', () => {
    expect(
      windowStartForSnapshot(
        [item('first'), item('missing')],
        1,
        Array.from({ length: 50 }, (_, index) => item(String(index))),
        40
      )
    ).toBe(10);
  });

  test('falls back to the newest page when the previous window is empty', () => {
    expect(
      windowStartForSnapshot(
        [],
        0,
        Array.from({ length: 50 }, (_, index) => item(String(index))),
        40
      )
    ).toBe(10);
  });
});
