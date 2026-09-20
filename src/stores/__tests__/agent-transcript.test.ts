import { describe, expect, test } from 'bun:test';
import { createAgentTranscriptStore } from '../agent-transcript';
import { windowStartForSnapshot } from '@/lib/agent-timeline-window';
import type { TimelineItem } from '@/lib/agent-protocol';
import { upsertTimelineItems } from '@/lib/agent-timeline-upsert';

const item = (id: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({
  id,
  message_id: 'message',
  role: 'assistant',
  ordinal: 0,
  seq: 1,
  updated_ms: 1,
  part: { type: 'text', text: id },
  ...extra,
});

describe('agent transcript ownership', () => {
  test('session replacement publishes its window and rows in one notification', () => {
    const store = createAgentTranscriptStore();
    store.getState().setTimeline(
      Array.from({ length: 100 }, (_, i) => item(`old-${i}`)),
      60
    );
    const observed: string[][] = [];
    const stop = store.subscribe((state) => observed.push([...state.keys]));
    store.getState().setTimeline([item('new-first'), item('new-last')], 0);
    stop();
    expect(observed).toEqual([['grp_new-first', 'grp_new-last']]);
    expect(store.getState().config.windowStart).toBe(0);
  });

  test('snapshot replacement publishes its moved window and rows in one notification', () => {
    const store = createAgentTranscriptStore();
    store.getState().setTimeline([item('old'), item('anchor'), item('last')], 1);
    const observed: { windowStart: number; keys: string[] }[] = [];
    const stop = store.subscribe((state) =>
      observed.push({ windowStart: state.config.windowStart, keys: [...state.keys] })
    );
    const snapshot = [item('new-first'), item('anchor'), item('last')];
    const nextWindow = windowStartForSnapshot(store.getState().timeline, 1, snapshot, 40);
    store.getState().setTimeline(snapshot, nextWindow);
    stop();
    expect(observed).toEqual([{ windowStart: 1, keys: ['grp_anchor', 'grp_last'] }]);
  });

  test('a latest page made of duplicate shells still shows the latest real messages', () => {
    const store = createAgentTranscriptStore();
    const tools = Array.from({ length: 60 }, (_, i) =>
      item(`tool-${i}`, {
        part: {
          type: 'tool',
          id: `call-${i}`,
          name: 'shell',
          input: { command: `echo ${i}` },
          content: [],
          metadata: {},
          state: 'completed',
        },
      })
    );
    const shells = Array.from({ length: 60 }, (_, i) =>
      item(`shell-${i}`, {
        part: { type: 'shell', shell_id: `shell-${i}`, command: `echo ${i}`, status: 'exited' },
      })
    );
    store.getState().setTimeline([...tools, ...shells]);
    store.getState().configure({ shells: [], windowStart: 80, status: 'idle' });
    expect(store.getState().keys).toHaveLength(40);
    expect(store.getState().keys.at(-1)).toBe('grp_tool-59');
    store.getState().configure({ shells: [], windowStart: 0, status: 'idle' });
    expect(store.getState().keys).toHaveLength(60);
  });

  test('filtering before the window preserves its original timeline anchor', () => {
    const store = createAgentTranscriptStore();
    store.getState().setTimeline([
      item('tool', {
        part: {
          type: 'tool',
          id: 'call',
          name: 'shell',
          input: { command: 'pwd' },
          content: [],
          metadata: {},
          state: 'completed',
        },
      }),
      item('duplicate', {
        part: { type: 'shell', shell_id: 'shell', command: 'pwd', status: 'exited' },
      }),
      item('anchor'),
      item('last'),
    ]);
    store.getState().configure({ shells: [], windowStart: 2, status: 'idle' });
    expect(store.getState().keys).toEqual(['grp_anchor', 'grp_last']);
  });

  test('200 streamed revisions invalidate only their row, not list keys or workbench summaries', () => {
    const store = createAgentTranscriptStore();
    store.getState().setTimeline(Array.from({ length: 500 }, (_, i) => item(String(i))));
    const initial = store.getState();
    let listUpdates = 0,
      coldRowUpdates = 0,
      hotRowUpdates = 0,
      summaryUpdates = 0;
    const stop = store.subscribe((state, previous) => {
      if (state.keys !== previous.keys) listUpdates++;
      if (state.rows.grp_0 !== previous.rows.grp_0) coldRowUpdates++;
      if (state.rows.grp_499 !== previous.rows.grp_499) hotRowUpdates++;
      if (
        state.toolIds !== previous.toolIds ||
        state.todos !== previous.todos ||
        state.backgroundTools !== previous.backgroundTools
      )
        summaryUpdates++;
    });
    for (let seq = 2; seq < 202; seq++) {
      store.getState().setTimeline((rows) =>
        upsertTimelineItems(rows, [
          item('499', {
            seq,
            part: { type: 'text', text: 'stream '.repeat(seq) },
          }),
        ])
      );
    }
    stop();
    expect({ listUpdates, coldRowUpdates, hotRowUpdates, summaryUpdates }).toEqual({
      listUpdates: 0,
      coldRowUpdates: 0,
      hotRowUpdates: 200,
      summaryUpdates: 0,
    });
    expect(store.getState().keys).toBe(initial.keys);
    expect(initial.rows.grp_499.items[0].seq).toBe(1);
  });

  test('prepend, reorder, removal and replacement keep correct keys and row contents', () => {
    const store = createAgentTranscriptStore();
    const a = item('a'),
      b = item('b');
    store.getState().setTimeline([a, b]);
    const oldB = store.getState().rows.grp_b;
    store.getState().setTimeline([item('earlier'), b, a]);
    expect(store.getState().keys).toEqual(['grp_earlier', 'grp_b', 'grp_a']);
    expect(store.getState().rows.grp_b).toBe(oldB);
    store.getState().setTimeline([b]);
    expect(store.getState().keys).toEqual(['grp_b']);
    expect(store.getState().rows.grp_a).toBeUndefined();
    store.getState().setTimeline([item('new-session')]);
    expect(store.getState().rows.grp_b).toBeUndefined();
  });

  test('user attachments stay together and assistant parts are separate virtual units', () => {
    const store = createAgentTranscriptStore();
    const user = item('user', { role: 'user', message_id: 'user', row_key: 'optimistic' });
    store
      .getState()
      .setTimeline([user, { ...user, id: 'attachment', row_key: undefined }, item('a'), item('b')]);
    expect(store.getState().keys).toEqual(['grp_optimistic', 'grp_a', 'grp_b']);
    expect(store.getState().rows.grp_optimistic.items).toHaveLength(2);
    store.getState().setTimeline([{ ...user, id: 'acknowledged', queued: false }, item('a')]);
    expect(store.getState().keys[0]).toBe('grp_optimistic');
    expect(store.getState().rows.grp_optimistic.items[0].id).toBe('acknowledged');
  });

  test('reasoning liveness changes without changing row data or list keys', () => {
    const store = createAgentTranscriptStore();
    const r1 = item('r1', { part: { type: 'reasoning', text: 'first' } });
    const r2 = item('r2', { part: { type: 'reasoning', text: 'second' } });
    store.getState().setTimeline([r1, r2]);
    const row = store.getState().rows.grp_r1;
    expect(row.items).toHaveLength(2);
    store.getState().configure({ shells: [], windowStart: 0, status: 'busy' });
    expect(store.getState().reasoningKey).toBe('grp_r1');
    store.getState().configure({ shells: [], windowStart: 0, status: 'interrupted' });
    expect(store.getState().reasoningKey).toBeUndefined();
    expect(store.getState().rows.grp_r1).toBe(row);
    store.getState().setTimeline([r1, r2, item('answer')]);
    store.getState().configure({ shells: [], windowStart: 0, status: 'busy' });
    expect(store.getState().reasoningKey).toBeUndefined();
  });

  test('local queue changes without sequence changes invalidate the user row', () => {
    const store = createAgentTranscriptStore();
    const queued = item('q', { role: 'user', queued: true });
    store.getState().setTimeline([queued]);
    const before = store.getState().rows.grp_q;
    store.getState().setTimeline([{ ...queued, queued: false }]);
    expect(store.getState().rows.grp_q).not.toBe(before);
    expect(store.getState().rows.grp_q.items[0].queued).toBe(false);
  });

  test('history window and tool echo dependency survive reasoning between parts', () => {
    const store = createAgentTranscriptStore();
    const tool = item('tool', {
      part: {
        type: 'tool',
        id: 'call',
        name: 'read',
        input: {},
        content: [],
        metadata: {},
        state: 'completed',
        output: 'result',
      },
    });
    store
      .getState()
      .setTimeline([
        item('older'),
        tool,
        item('reasoning', { part: { type: 'reasoning', text: 'thought' } }),
        item('answer'),
      ]);
    store.getState().configure({ shells: [], windowStart: 1, status: 'idle' });
    expect(store.getState().keys).toEqual(['grp_tool', 'grp_reasoning', 'grp_answer']);
    expect(store.getState().rows.grp_answer.prevItem).toBe(tool);
    store.getState().configure({ shells: [], windowStart: 0, status: 'idle' });
    expect(store.getState().keys[0]).toBe('grp_older');
  });
});
