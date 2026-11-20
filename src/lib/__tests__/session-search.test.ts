import { expect, test } from 'bun:test';
import type { TimelineRenderGroup } from '../agent-timeline-groups';
import type { TimelineItem } from '../agent-protocol';
import {
  mergeSessionSearchPages,
  parseSessionSearchPage,
  revealRowKey,
  sessionSearchIndexing,
  sessionSearchPath,
  sessionSearchQuery,
  snippetSegments,
  type SessionSearchHit,
} from '../session-search';

const wire = (over: Record<string, unknown> = {}) => ({
  asid: 's1',
  agent_id: 'codex',
  title: 'Billing',
  directory: '/w/app',
  parent_asid: null,
  item_id: 'i1',
  message_id: 'm1',
  role: 'user',
  kind: 'text',
  time_ms: 1000,
  snippet: '数据库 billing tables',
  highlights: [[0, 3]],
  session_hits: 5,
  ...over,
});

test('parses the envelope, drops malformed rows and repairs highlights', () => {
  const page = parseSessionSearchPage({
    data: {
      items: [
        wire({ highlights: [[8, 99], [4, 9], [0, 3], [2, 1], 'x'] }),
        wire({ item_id: '' }),
        { asid: 's2' },
        wire({ asid: 's3', role: 'system', kind: 'odd', session_hits: 0, message_id: null }),
      ],
      next_cursor: '20',
      indexing: { done: 400, total: 340 },
    },
  });
  expect(page.hits.map((hit) => hit.asid)).toEqual(['s1', 's3']);
  // Clamped to the snippet, sorted, overlaps merged, inverted ranges dropped.
  expect(page.hits[0].highlights).toEqual([
    [0, 3],
    [4, 18],
  ]);
  expect(page.hits[0].parentAsid).toBeUndefined();
  expect(page.hits[1]).toMatchObject({
    role: 'assistant',
    kind: 'text',
    sessionHits: 1,
    messageId: 'i1',
  });
  expect(page.nextCursor).toBe('20');
  expect(page.indexing).toEqual({ done: 340, total: 340 });
  expect(parseSessionSearchPage(null)).toEqual({ hits: [], nextCursor: null, indexing: null });
});

test('snippet segments follow UTF-16 highlight offsets', () => {
  // The emoji is two UTF-16 code units; the gateway counts it that way too.
  const snippet = 'a😀数据库 ok';
  expect(snippetSegments(snippet, [[3, 6]])).toEqual([
    { text: 'a😀', hit: false },
    { text: '数据库', hit: true },
    { text: ' ok', hit: false },
  ]);
  expect(snippetSegments('abc', [])).toEqual([{ text: 'abc', hit: false }]);
});

test('query and path: trimmed, collapsed, bounded and scoped', () => {
  expect(sessionSearchQuery('   ')).toBeNull();
  expect(sessionSearchQuery('  ser   mod ')).toBe('ser mod');
  expect(sessionSearchQuery('x'.repeat(300))).toHaveLength(200);
  expect(
    sessionSearchPath({ query: '数据 库', limit: 80, agentId: 'claude', directory: 'rel/path' })
  ).toBe(
    `/api/search?q=${encodeURIComponent('数据 库').replace(/%20/g, '+')}&limit=50&agent_id=claude`
  );
});

const hit = (asid: string, itemId: string, timeMs: number, sessionHits = 1): SessionSearchHit => ({
  ...parseSessionSearchPage({ items: [wire()] }).hits[0],
  asid,
  itemId,
  timeMs,
  sessionHits,
});

test('merge interleaves computers by rank, keeps a session together and dedupes', () => {
  const groups = mergeSessionSearchPages([
    {
      serverId: 'a',
      hits: [hit('a1', 'x', 10, 7), hit('a1', 'y', 5, 7), hit('a1', 'x', 10, 7), hit('a2', 'z', 1)],
    },
    { serverId: 'b', hits: [hit('b1', 'w', 50)] },
  ]);
  expect(groups.map((group) => [group.serverId, group.hits[0].asid, group.hits.length])).toEqual([
    ['b', 'b1', 1],
    ['a', 'a1', 2],
    ['a', 'a2', 1],
  ]);
  expect(groups[1].more).toBe(5);
  expect(groups[1].hits[0].serverId).toBe('a');
});

test('indexing progress sums computers and disappears once current', () => {
  expect(sessionSearchIndexing([{ done: 3, total: 5 }, null, { done: 2, total: 2 }])).toEqual({
    done: 5,
    total: 7,
  });
  expect(sessionSearchIndexing([{ done: 2, total: 2 }, null])).toBeNull();
});

test('a hit lands on the group holding its item, else on its message', () => {
  const item = (id: string, messageId: string) => ({ id, message_id: messageId }) as TimelineItem;
  const rows: Record<string, TimelineRenderGroup> = {
    grp_u: { key: 'grp_u', role: 'user', items: [item('u1', 'mu'), item('u2', 'mu')] },
    grp_a: { key: 'grp_a', role: 'assistant', items: [item('a1', 'ma')] },
    grp_b: { key: 'grp_b', role: 'assistant', items: [item('a2', 'ma')] },
  };
  const keys = ['grp_u', 'grp_a', 'grp_b'];
  expect(revealRowKey(keys, rows, 'u2', 'mu')).toBe('grp_u');
  expect(revealRowKey(keys, rows, 'a2', 'ma')).toBe('grp_b');
  expect(revealRowKey(keys, rows, 'gone', 'ma')).toBe('grp_a');
  expect(revealRowKey(keys, rows, 'gone', 'none')).toBeUndefined();
});
