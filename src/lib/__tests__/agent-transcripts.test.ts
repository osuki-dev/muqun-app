import { describe, expect, test } from 'bun:test';

import type { TimelineItem } from '../agent-protocol';
import {
  agentSessionOf,
  createTranscriptReader,
  mergeTranscriptItems,
  parseTranscriptPage,
  transcriptAvailability,
  transcriptHeadChanged,
  transcriptPath,
  transcriptReaderTokens,
  TranscriptReadError,
  type TranscriptHead,
  type TranscriptPage,
  type TranscriptReaderState,
} from '../agent-transcripts';
import { healthCapabilityNames } from '../server-capabilities';

/** A text entry on file line `line`, as the Gateway projects one. */
function entry(
  line: number,
  text = `line ${line}`,
  part: TimelineItem['part'] = { type: 'text', text }
) {
  const message = `tx_claude_${String(line).padStart(12, '0')}`;
  return {
    id: `${message}:text:0`,
    message_id: message,
    role: 'user' as const,
    ordinal: 0,
    part,
    seq: line + 1,
    updated_ms: 1_000 + line,
  };
}

const head = (lines: number, bytes = lines * 100): TranscriptHead => ({
  lines,
  entries: lines,
  bytes,
});

function wirePage(lines: number[], nextBefore: string | null, total = 10) {
  return {
    data: {
      agent: 'claude',
      session_id: 's',
      items: lines.map((line) => entry(line)),
      order: 'oldest-to-newest',
      has_more: nextBefore !== null,
      next_before: nextBefore,
      skipped_lines: 0,
      head: { lines: total, entries: total, bytes: total * 100, mtime_ms: 5, malformed_lines: 0 },
    },
  };
}

describe('capability detection', () => {
  test('reader tokens come only from a gateway that announces transcript reading', () => {
    expect(
      transcriptReaderTokens({
        capabilities: ['agent_transcripts_v1'],
        agent_transcripts: ['claude', ' claude ', 7, 'aider'],
      })
    ).toEqual(['agent_transcripts:claude', 'agent_transcripts:aider']);
    expect(transcriptReaderTokens({ capabilities: [], agent_transcripts: ['claude'] })).toEqual([]);
    expect(transcriptReaderTokens({ capabilities: ['agent_transcripts_v1'] })).toEqual([]);
    expect(transcriptReaderTokens(null)).toEqual([]);
  });

  test('the mirror keeps the health list and the reader tokens together', () => {
    expect(
      healthCapabilityNames({
        capabilities: ['agent_sessions', 'agent_transcripts_v1'],
        agent_transcripts: ['claude'],
      })
    ).toEqual(['agent_sessions', 'agent_transcripts_v1', 'agent_transcripts:claude']);
    expect(healthCapabilityNames({ capabilities: ['agent_sessions'] })).toEqual(['agent_sessions']);
  });

  test('availability says what is missing rather than guessing', () => {
    expect(transcriptAvailability(undefined, 'claude')).toBe('gateway-upgrade');
    expect(transcriptAvailability(['agent_sessions'], 'claude')).toBe('gateway-upgrade');
    expect(transcriptAvailability(['agent_transcripts_v1'], 'claude')).toBe('agent-unsupported');
    expect(
      transcriptAvailability(['agent_transcripts_v1', 'agent_transcripts:claude'], 'claude')
    ).toBe('available');
    expect(
      transcriptAvailability(['agent_transcripts_v1', 'agent_transcripts:claude'], 'codex')
    ).toBe('agent-unsupported');
  });

  test("herdr's agent_session names the reader's agent and session id", () => {
    expect(
      agentSessionOf({
        agent: 'claude',
        agent_session: {
          agent: 'claude',
          kind: 'id',
          source: 'herdr:claude',
          value: 'c0ff722c-2810-41ce-8abd-bc97683d3c6e',
        },
      })
    ).toEqual({ agent: 'claude', sessionId: 'c0ff722c-2810-41ce-8abd-bc97683d3c6e' });
    expect(agentSessionOf({ agent: 'codex' })).toBeNull();
    expect(
      agentSessionOf({ agent_session: { agent: 'claude', kind: 'name', value: 'x' } })
    ).toBeNull();
    expect(agentSessionOf({ agent_session: { agent: '', value: 'x' } })).toBeNull();
    expect(agentSessionOf(undefined)).toBeNull();
  });
});

describe('wire contract', () => {
  test('the route carries the agent, the session, the cwd hint and the cursor', () => {
    expect(
      transcriptPath({ agent: 'claude', sessionId: 'abc', cwd: '/w/p' }, '', {
        limit: '40',
        before: '00ff.12',
      })
    ).toBe('/api/agents/transcripts/claude/abc?cwd=%2Fw%2Fp&limit=40&before=00ff.12');
    expect(transcriptPath({ agent: 'claude', sessionId: 'a/b' }, '/head', {})).toBe(
      '/api/agents/transcripts/claude/a%2Fb/head'
    );
  });

  test('a page is read out of its envelope, oldest first, with its cursor and head', () => {
    const page = parseTranscriptPage(wirePage([8, 9], 'ee.8'));
    expect(page.items.map((item) => item.seq)).toEqual([9, 10]);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe('ee.8');
    expect(page.head).toEqual({ lines: 10, entries: 10, bytes: 1000 });
    // has_more without a cursor is nothing to follow.
    expect(
      parseTranscriptPage({ data: { ...wirePage([1], null).data, has_more: true } }).hasMore
    ).toBe(false);
    expect(() => parseTranscriptPage({ data: { items: [] } })).toThrow('Invalid transcript page');
  });

  test('the head changes on lines or bytes', () => {
    expect(transcriptHeadChanged(null, head(1))).toBe(true);
    expect(transcriptHeadChanged(head(3), head(3))).toBe(false);
    expect(transcriptHeadChanged(head(3), head(4))).toBe(true);
    expect(transcriptHeadChanged(head(3), head(3, 999))).toBe(true);
  });
});

describe('merge', () => {
  test('pages dedupe by id, keep file order and keep the array when nothing changed', () => {
    const held = [entry(5), entry(6)];
    expect(mergeTranscriptItems(held, [entry(6), entry(5)])).toBe(held);
    const merged = mergeTranscriptItems(held, [entry(2), entry(7), entry(3)]);
    expect(merged.map((item) => item.seq)).toEqual([3, 4, 6, 7, 8]);
  });

  test('a re-read item replaces its copy only when it changed', () => {
    const running = entry(4, '', {
      type: 'tool',
      id: 't1',
      name: 'Bash',
      state: 'running',
      input: {},
    } as TimelineItem['part']);
    const done = { ...running, part: { ...running.part, state: 'completed' } } as TimelineItem;
    const held = [entry(3), running];
    expect(mergeTranscriptItems(held, [running])).toBe(held);
    const merged = mergeTranscriptItems(held, [done]);
    expect(merged[1]).toBe(done);
    expect(merged[0]).toBe(held[0]);
  });
});

/** A transcript of `total` entries served a page at a time, newest first. */
function fakeSource(total: number) {
  const calls: ({ before?: string; limit: number } | 'head')[] = [];
  let lines = total;
  const cursorOf = (line: number) => `0000000000000001.${line}`;
  const pageEnding = (end: number, limit: number): TranscriptPage => {
    const start = Math.max(0, end - limit);
    const items = [];
    for (let line = start; line < end; line++) items.push(entry(line));
    return {
      items,
      hasMore: start > 0,
      nextBefore: start > 0 ? cursorOf(start) : null,
      head: head(lines),
    };
  };
  const source = {
    page: async (query: { before?: string; limit: number }) => {
      calls.push(query);
      const end = query.before ? Number(query.before.split('.')[1]) : lines;
      return pageEnding(end, query.limit);
    },
    head: async () => {
      calls.push('head');
      return head(lines);
    },
  };
  return {
    source,
    calls,
    append: (count: number) => {
      lines += count;
    },
  };
}

function seqs(state: TranscriptReaderState) {
  return state.items.map((item) => item.seq - 1);
}

describe('reader', () => {
  test('opens on the newest page and walks older pages through the cursor without repeats', async () => {
    const fake = fakeSource(7);
    const states: TranscriptReaderState[] = [];
    const reader = createTranscriptReader(fake.source, (state) => states.push(state), {
      pageSize: 3,
    });
    await reader.open();
    expect(seqs(reader.getState())).toEqual([4, 5, 6]);
    expect(reader.getState()).toMatchObject({ loaded: true, hasMore: true, failed: false });

    await reader.loadOlder();
    expect(seqs(reader.getState())).toEqual([1, 2, 3, 4, 5, 6]);
    expect(states.some((state) => state.loadingOlder)).toBe(true);
    await reader.loadOlder();
    expect(seqs(reader.getState())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reader.getState().hasMore).toBe(false);
    // The oldest page is the end: asking again sends nothing.
    const sent = fake.calls.length;
    await reader.loadOlder();
    expect(fake.calls.length).toBe(sent);
    expect(fake.calls).toEqual([
      { limit: 3 },
      { before: '0000000000000001.4', limit: 3 },
      { before: '0000000000000001.1', limit: 3 },
    ]);
    reader.dispose();
  });

  test('a check reads nothing while the head is unchanged and appends what arrived', async () => {
    const fake = fakeSource(5);
    const reader = createTranscriptReader(fake.source, () => {}, { pageSize: 3 });
    await reader.open();
    await reader.loadOlder();
    expect(reader.getState().hasMore).toBe(false);
    fake.calls.length = 0;
    await reader.check();
    expect(fake.calls).toEqual(['head']);

    fake.append(2);
    fake.calls.length = 0;
    await reader.check();
    expect(fake.calls).toEqual(['head', { limit: 3 }]);
    expect(seqs(reader.getState())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(reader.getState().head?.lines).toBe(7);
    reader.dispose();
  });

  test('a check keeps the older cursor while catching up over several pages', async () => {
    const fake = fakeSource(4);
    const reader = createTranscriptReader(fake.source, () => {}, { pageSize: 2 });
    await reader.open();
    expect(seqs(reader.getState())).toEqual([2, 3]);
    fake.append(3);
    fake.calls.length = 0;
    await reader.check();
    // Newest page [5,6], then [3,4] which meets the held 3.
    expect(fake.calls).toEqual(['head', { limit: 2 }, { before: '0000000000000001.5', limit: 2 }]);
    expect(seqs(reader.getState())).toEqual([2, 3, 4, 5, 6]);
    expect(reader.getState().hasMore).toBe(true);
    // The older cursor still points below what was held when the reader opened.
    await reader.loadOlder();
    expect(seqs(reader.getState())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    reader.dispose();
  });

  test('a check that cannot reach what was held keeps only the newest pages', async () => {
    const fake = fakeSource(2);
    const reader = createTranscriptReader(fake.source, () => {}, { pageSize: 2 });
    await reader.open();
    expect(seqs(reader.getState())).toEqual([0, 1]);
    fake.append(20);
    await reader.check();
    // Three pages back from 22 reach line 16; the held 0 and 1 are let go.
    expect(seqs(reader.getState())).toEqual([16, 17, 18, 19, 20, 21]);
    expect(reader.getState().hasMore).toBe(true);
    await reader.loadOlder();
    expect(seqs(reader.getState())[0]).toBe(14);
    reader.dispose();
  });

  test('an empty transcript fills in from its first entries', async () => {
    const fake = fakeSource(0);
    const reader = createTranscriptReader(fake.source, () => {}, { pageSize: 2 });
    await reader.open();
    expect(reader.getState()).toMatchObject({ loaded: true, hasMore: false, items: [] });
    fake.append(3);
    await reader.check();
    expect(seqs(reader.getState())).toEqual([1, 2]);
    expect(reader.getState().hasMore).toBe(true);
    await reader.loadOlder();
    expect(seqs(reader.getState())).toEqual([0, 1, 2]);
    reader.dispose();
  });

  test('a lost cursor starts again from the newest page; a missing transcript stops', async () => {
    const fake = fakeSource(4);
    let refuse: TranscriptReadError | null = null;
    const source = {
      page: async (query: { before?: string; limit: number }) => {
        if (refuse && query.before) throw refuse;
        return fake.source.page(query);
      },
      head: fake.source.head,
    };
    const reader = createTranscriptReader(source, () => {}, { pageSize: 2 });
    await reader.open();
    refuse = new TranscriptReadError('transcript_cursor_gone', 410);
    fake.append(1);
    await reader.loadOlder();
    expect(seqs(reader.getState())).toEqual([3, 4]);
    expect(reader.getState()).toMatchObject({ loadingOlder: false, failed: false, hasMore: true });

    const gone = createTranscriptReader(
      {
        page: async () => {
          throw new TranscriptReadError('transcript_not_found', 404);
        },
        head: fake.source.head,
      },
      () => {}
    );
    await gone.open();
    expect(gone.getState()).toMatchObject({ loaded: true, missing: true, failed: false });
    const before = fake.calls.length;
    await gone.check();
    expect(fake.calls.length).toBe(before);
    reader.dispose();
    gone.dispose();
  });

  test('nothing is published after dispose', async () => {
    let resolve: ((page: TranscriptPage) => void) | undefined;
    const states: TranscriptReaderState[] = [];
    const reader = createTranscriptReader(
      {
        page: () =>
          new Promise<TranscriptPage>((done) => {
            resolve = done;
          }),
        head: async () => head(1),
      },
      (state) => states.push(state)
    );
    const opening = reader.open();
    reader.dispose();
    resolve?.({
      items: [entry(0)],
      hasMore: false,
      nextBefore: null,
      head: head(1),
    });
    await opening;
    expect(states).toEqual([]);
  });
});
