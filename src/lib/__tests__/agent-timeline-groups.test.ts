import { describe, expect, test } from 'bun:test';

import type { TimelineItem } from '../agent-protocol';
import {
  buildTimelineGroups,
  buildTimelineGroupsCached,
  createTimelineGroupCache,
  reconcileShellParts,
} from '../agent-timeline-groups';

function item(id: string, messageId: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id,
    message_id: messageId,
    role: 'assistant',
    ordinal: 0,
    part: { type: 'text', text: id },
    seq: 1,
    updated_ms: 1,
    ...extra,
  };
}

describe('buildTimelineGroups', () => {
  test('consecutive items sharing a message are one group', () => {
    const groups = buildTimelineGroups([
      item('msg_1:t0', 'msg_1'),
      item('msg_1:tool:a', 'msg_1'),
      item('msg_2:t0', 'msg_2'),
    ]);
    expect(groups.map((group) => group.items.length)).toEqual([2, 1]);
    expect(groups[0].key).toBe('grp_msg_1:t0');
  });

  test('a user message and an assistant message never merge', () => {
    const groups = buildTimelineGroups([item('u', 'msg_1', { role: 'user' }), item('a', 'msg_2')]);
    expect(groups.map((group) => group.role)).toEqual(['user', 'assistant']);
  });

  test('each group carries the item before it, for the tool-output dedup', () => {
    const groups = buildTimelineGroups([item('a', 'msg_1'), item('b', 'msg_2')]);
    expect(groups[0].prevItem).toBeUndefined();
    expect(groups[1].prevItem?.id).toBe('a');
  });

  test('nothing is nothing', () => {
    expect(buildTimelineGroups([])).toEqual([]);
  });
});

describe('reuse across renders', () => {
  const first = [item('msg_1:t0', 'msg_1'), item('msg_2:t0', 'msg_2')];

  test('an untouched group keeps its identity', () => {
    const before = buildTimelineGroups(first);
    const after = buildTimelineGroups(first, before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  /**
   * The bug this file exists for: a group taken from `previous` used to be
   * pushed into, so the object the memoised cell compares by reference gained
   * a part without changing identity. The reader watched a tool run and the
   * card never appeared.
   */
  test('appending a part to a group yields a NEW object', () => {
    const before = buildTimelineGroups(first);
    const grown = [first[0], item('msg_1:tool:a', 'msg_1'), first[1]];
    const after = buildTimelineGroups(grown, before);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0].items).toHaveLength(2);
    // And the previous render's array is untouched, which is what a render
    // still holding it depends on.
    expect(before[0].items).toHaveLength(1);
  });

  test('a multi-item group can be reused, which is the whole point of the memo', () => {
    // Under the old shape the signature was computed against a one-item
    // candidate, so a message with a tool call in it never matched and the
    // memo was dead for exactly the messages that cost the most to draw.
    const withTool = [item('msg_1:t0', 'msg_1'), item('msg_1:tool:a', 'msg_1')];
    const before = buildTimelineGroups(withTool);
    const after = buildTimelineGroups(withTool, before);
    expect(after[0]).toBe(before[0]);
  });

  test('a revised item breaks reuse for its own group and leaves the rest alone', () => {
    // The later group is the one revised, so nothing above it is disturbed --
    // which is the whole reason a streamed reply costs one cell rather than
    // the visible list.
    const before = buildTimelineGroups(first);
    const after = buildTimelineGroups([first[0], { ...first[1], seq: 2 }], before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  test('a row the gateway never numbered is still seen to change', () => {
    // `seq` stays 0 for every revision on a gateway that does not number
    // rows; `updated_ms` is what tells the two apart.
    const unnumbered = [item('msg_1:t0', 'msg_1', { seq: 0, updated_ms: 10 })];
    const before = buildTimelineGroups(unnumbered);
    const after = buildTimelineGroups(
      [item('msg_1:t0', 'msg_1', { seq: 0, updated_ms: 20 })],
      before
    );
    expect(after[0]).not.toBe(before[0]);
  });

  test('a group whose preceding item changed is rebuilt', () => {
    // `prevItem` feeds the "this text merely echoes the tool above it" check,
    // so a group whose neighbour changed has to redraw.
    const before = buildTimelineGroups(first);
    const after = buildTimelineGroups([{ ...first[0], seq: 9 }, first[1]], before);
    expect(after[1]).not.toBe(before[1]);
  });

  test('an insertion above shifts the comparison and does not reuse by position', () => {
    const before = buildTimelineGroups(first);
    const after = buildTimelineGroups([item('msg_0:t0', 'msg_0'), ...first], before);
    // Position 0 is a different message now, so nothing at that index is kept.
    expect(after[0]).not.toBe(before[0]);
    expect(after.map((group) => group.key)).toEqual([
      'grp_msg_0:t0',
      'grp_msg_1:t0',
      'grp_msg_2:t0',
    ]);
  });
});

describe('buildTimelineGroupsCached', () => {
  test('the second call with the same items returns the identical objects', () => {
    // Which is what makes filling the cache during render safe under Strict
    // Mode's double render: the operation is idempotent.
    const cache = createTimelineGroupCache();
    const items = [item('a', 'msg_1')];
    const once = buildTimelineGroupsCached(cache, items);
    const twice = buildTimelineGroupsCached(cache, items);
    expect(twice[0]).toBe(once[0]);
  });

  test('it still sees an appended part', () => {
    const cache = createTimelineGroupCache();
    const once = buildTimelineGroupsCached(cache, [item('a', 'msg_1')]);
    const twice = buildTimelineGroupsCached(cache, [item('a', 'msg_1'), item('b', 'msg_1')]);
    expect(twice[0]).not.toBe(once[0]);
    expect(twice[0].items).toHaveLength(2);
  });
});

describe('reconcileShellParts', () => {
  function shellPart(id: string, command: string, status: 'running' | 'exited'): TimelineItem {
    return {
      id,
      message_id: `msg_${id}`,
      role: 'assistant',
      ordinal: 0,
      part: { type: 'shell', shell_id: id, command, status },
      seq: 1,
      updated_ms: 1,
    };
  }

  function shellCall(id: string, command: string): TimelineItem {
    return {
      id,
      message_id: `msg_${id}`,
      role: 'assistant',
      ordinal: 0,
      part: {
        type: 'tool',
        id,
        name: 'shell',
        input: { command },
        content: [],
        metadata: {},
        state: 'completed',
      },
      seq: 1,
      updated_ms: 1,
    };
  }

  test('a shell part that mirrors a tool call is dropped', () => {
    const items = [shellCall('call1', 'ls -la'), shellPart('sh1', 'ls -la', 'exited')];
    const next = reconcileShellParts(items, []);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('call1');
  });

  test('a detached shell with no call behind it stays', () => {
    const items = [shellCall('call1', 'ls -la'), shellPart('sh2', 'sleep 120', 'running')];
    const next = reconcileShellParts(items, [
      { id: 'sh2', status: 'running', command: 'sleep 120', metadata: {} },
    ]);
    expect(next).toHaveLength(2);
    expect(next[1].part).toMatchObject({ type: 'shell', status: 'running' });
  });

  test('a shell the tray no longer lists has finished', () => {
    const items = [shellPart('sh3', 'sleep 120', 'running')];
    const next = reconcileShellParts(items, []);
    expect(next[0].part).toMatchObject({ type: 'shell', status: 'exited' });
  });

  test('the list is the authority on status', () => {
    const items = [shellPart('sh4', 'tail -f log', 'exited')];
    const next = reconcileShellParts(items, [
      { id: 'sh4', status: 'running', command: 'tail -f log', metadata: {} },
    ]);
    expect(next[0].part).toMatchObject({ type: 'shell', status: 'running' });
  });

  test('a timeline with no shell parts is handed back unchanged', () => {
    const items = [shellCall('call1', 'ls -la')];
    expect(reconcileShellParts(items, [])).toBe(items);
  });
});
