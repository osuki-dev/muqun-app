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
  test('streaming a long table preserves the initial prompt, history identities and measured row keys', () => {
    const store = createAgentTranscriptStore();
    const prompt = item('user', { role: 'user', message_id: 'prompt', order: '002' });
    const history = item('history', { message_id: 'history', order: '001' });
    store.getState().setTimeline([history, prompt]);
    store.getState().configure({ windowStart: 0, status: 'busy' });
    expect(store.getState().streamingKey).toBeUndefined();
    const historyRow = store.getState().rows.grp_history;
    const promptRow = store.getState().rows.grp_user;
    const answer =
      '本机配置如下：\n\n| 项目 | 配置 |\n| --- | --- |\n' +
      Array.from(
        { length: 30 },
        (_, i) => `| 部件 ${i} | Streaming fixture with **long wrapped text** ${i} |\n`
      ).join('');
    let keys: string[] | undefined;
    for (let end = 1; end <= answer.length; end += 23) {
      store.getState().setTimeline((previous) =>
        upsertTimelineItems(previous, [
          item('answer', {
            message_id: 'answer',
            order: '003',
            seq: end,
            part: { type: 'text', text: answer.slice(0, end) },
          }),
        ])
      );
      const state = store.getState();
      expect(state.rows.grp_history).toBe(historyRow);
      expect(state.rows.grp_user).toBe(promptRow);
      expect(state.streamingKey).toBe('grp_answer');
      if (keys) expect(state.keys).toBe(keys);
      keys = state.keys;
    }
    store.getState().configure({ windowStart: 0, status: 'idle' });
    expect(store.getState().streamingKey).toBeUndefined();
    expect(store.getState().keys).toBe(keys!);
    expect(store.getState().rows.grp_user).toBe(promptRow);
  });

  test('only the live text tail streams; reasoning, tools and replaced sessions clear the flag', () => {
    const store = createAgentTranscriptStore();
    store.getState().configure({ windowStart: 0, status: 'busy' });
    store.getState().setTimeline([item('text')]);
    expect(store.getState().streamingKey).toBe('grp_text');
    store
      .getState()
      .setTimeline([
        item('text'),
        item('thought', { part: { type: 'reasoning', text: 'thinking' } }),
      ]);
    expect(store.getState().streamingKey).toBeUndefined();
    expect(store.getState().reasoningKey).toBe('grp_thought');
    store.getState().setTimeline([item('user', { role: 'user' })], 0);
    expect(store.getState().streamingKey).toBeUndefined();
  });

  test('thinking split by an empty reply part is one Thought row', () => {
    const store = createAgentTranscriptStore();
    const thought = (id: string) => item(id, { part: { type: 'reasoning', text: id } });
    store
      .getState()
      .setTimeline([
        thought('a'),
        item('blank', { part: { type: 'text', text: ' ' } }),
        thought('b'),
      ]);
    const state = store.getState();
    expect(state.keys.map((key) => state.rows[key].items.map((row) => row.id))).toEqual([
      ['a', 'b'],
    ]);
  });
  test('31 diagrams become independently virtualized rows without changing the canonical message', () => {
    const store = createAgentTranscriptStore();
    const text = Array.from(
      { length: 31 },
      (_, i) => `Diagram ${i}\n\n\`\`\`mermaid\nflowchart LR\nA${i} --> B${i}\n\`\`\`\n`
    ).join('\n');
    const message = item('diagrams', { part: { type: 'text', text } });
    store.getState().setTimeline([message]);
    const state = store.getState();
    const rows = state.keys.map((key) => state.rows[key]);
    expect(state.timeline).toEqual([message]);
    expect(
      rows
        .flatMap((row) => row.items)
        .map((row) => (row.part.type === 'text' ? row.part.text : ''))
        .join('')
    ).toBe(text);
    expect(
      rows.filter(
        (row) =>
          row.items[0].part.type === 'text' && row.items[0].part.text.startsWith('```mermaid')
      )
    ).toHaveLength(31);
    expect(new Set(state.keys).size).toBe(state.keys.length);
    store.getState().configure({ windowStart: 0, status: 'busy' });
    for (const key of state.keys) expect(store.getState().rows[key]).toBe(state.rows[key]);
  });
  test('message generation belongs only to the final visible fragment of diagram markdown', () => {
    for (const suffix of ['After diagram', '', '\n\n']) {
      const store = createAgentTranscriptStore();
      const generation = { scope: 'message' as const, tokens_per_second: 123.4 };
      const message = item('answer', {
        part: {
          type: 'text',
          text: `Before diagram\n\n\`\`\`mermaid\nflowchart LR\nA --> B\n\`\`\`\n${suffix}`,
        },
        generation,
      });
      store.getState().setTimeline([message]);
      const state = store.getState();
      const fragments = state.keys.flatMap((key) => state.rows[key].items);
      expect(fragments.length).toBeGreaterThan(1);
      expect(fragments.filter((fragment) => fragment.generation !== undefined)).toEqual(
        fragments.slice(-1)
      );
      expect(fragments.at(-1)?.generation).toBe(generation);
      expect(state.timeline[0]).toBe(message);
      expect(message.generation).toBe(generation);
      store.getState().configure({ windowStart: 0, status: 'busy' });
      expect(store.getState().streamingKey).toBe(state.keys.at(-1));
    }
  });
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

  test('a duplicate-shell window keeps fallback history when send appends a real row', () => {
    const store = createAgentTranscriptStore();
    const tools = Array.from({ length: 60 }, (_, i) =>
      item(`tool-${i}`, {
        part: {
          type: 'tool',
          id: `call-${i}`,
          name: 'shell',
          input: { command: `echo ${i}` },
          content: [],
          metadata: { shellID: `shell-${i}` },
          state: 'completed',
        },
      })
    );
    const shells = Array.from({ length: 60 }, (_, i) =>
      item(`shell_shell-${i}`, {
        message_id: `shell_shell-${i}`,
        part: { type: 'shell', shell_id: `shell-${i}`, command: `echo ${i}`, status: 'exited' },
      })
    );
    store.getState().setTimeline([...tools, ...shells]);
    store.getState().configure({ windowStart: 80, status: 'idle' });
    expect(store.getState().keys).toHaveLength(40);
    expect(store.getState().keys.at(-1)).toBe('grp_tool-59');
    const historyKeys = [...store.getState().keys];

    const optimistic = item('temp_user', {
      row_key: 'temp_user',
      message_id: 'prompt',
      role: 'user',
      order: 'zzzz',
      part: { type: 'text', text: 'hello' },
    });
    store.getState().setTimeline((timeline) => [...timeline, optimistic]);
    expect(store.getState().keys).toEqual([...historyKeys, 'grp_temp_user']);

    store.getState().configure({ windowStart: 80, status: 'busy' });
    expect(store.getState().keys).toEqual([...historyKeys, 'grp_temp_user']);

    store.getState().setTimeline((timeline) =>
      upsertTimelineItems(timeline, [
        item('acknowledged-user', {
          message_id: 'prompt',
          role: 'user',
          seq: 2,
          part: { type: 'text', text: 'hello' },
        }),
      ])
    );
    expect(store.getState().keys).toEqual([...historyKeys, 'grp_temp_user']);

    store
      .getState()
      .setTimeline((timeline) =>
        upsertTimelineItems(timeline, [item('answer', { message_id: 'answer', order: 'zzzzz' })])
      );
    expect(store.getState().keys).toEqual([...historyKeys, 'grp_temp_user', 'grp_answer']);

    store.getState().configure({ windowStart: 0, status: 'idle' });
    expect(store.getState().keys).toHaveLength(62);
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
      item('shell_shell', {
        message_id: 'shell_shell',
        part: { type: 'shell', shell_id: 'shell', command: 'pwd', status: 'exited' },
      }),
      item('anchor'),
      item('last'),
    ]);
    store.getState().configure({ windowStart: 2, status: 'idle' });
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
    store.getState().configure({ windowStart: 0, status: 'busy' });
    expect(store.getState().reasoningKey).toBe('grp_r1');
    store.getState().configure({ windowStart: 0, status: 'interrupted' });
    expect(store.getState().reasoningKey).toBeUndefined();
    expect(store.getState().rows.grp_r1).toBe(row);
    store.getState().setTimeline([r1, r2, item('answer')]);
    store.getState().configure({ windowStart: 0, status: 'busy' });
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
    store.getState().configure({ windowStart: 1, status: 'idle' });
    expect(store.getState().keys).toEqual(['grp_tool', 'grp_reasoning', 'grp_answer']);
    expect(store.getState().rows.grp_answer.prevItem).toBe(tool);
    store.getState().configure({ windowStart: 0, status: 'idle' });
    expect(store.getState().keys[0]).toBe('grp_older');
  });
});
