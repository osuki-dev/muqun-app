/**
 * Session content search (`GET /api/search`, capability `session_search_v1`).
 *
 * The gateway searches what was said in every agent session on its computer:
 * prompts, replies and tool-call headlines. This module is the wire contract
 * and the pure logic around it -- the page parser, the snippet's highlight
 * segments, the merge of several computers' pages, and finding a hit's row in
 * an opened transcript. Fetching and rendering live elsewhere.
 */
import type { TimelineRenderGroup } from './agent-timeline-groups';

export const SESSION_SEARCH_CAPABILITY = 'session_search_v1';

/** The gateway refuses more; trimmed, so trailing spaces never cost a request. */
export const SESSION_SEARCH_MAX_QUERY = 200;

export interface SessionSearchHit {
  asid: string;
  agentId: string;
  title: string;
  directory?: string;
  parentAsid?: string;
  itemId: string;
  messageId: string;
  role: 'user' | 'assistant';
  kind: 'text' | 'tool';
  timeMs: number;
  snippet: string;
  /** `[start, end)` in UTF-16 code units, sorted, inside the snippet, never overlapping. */
  highlights: readonly (readonly [number, number])[];
  /** How many of the session's rows matched, this hit included. */
  sessionHits: number;
}

export interface SessionSearchIndexing {
  done: number;
  total: number;
}

export interface SessionSearchPage {
  hits: SessionSearchHit[];
  nextCursor: string | null;
  indexing: SessionSearchIndexing | null;
}

/** A hit and the computer that answered it. */
export interface ServerSessionSearchHit extends SessionSearchHit {
  serverId: string;
}

/** The query as sent, or null when there is nothing worth asking. */
export function sessionSearchQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, ' ');
  if (!query) return null;
  return query.slice(0, SESSION_SEARCH_MAX_QUERY).trim();
}

export function sessionSearchPath(params: {
  query: string;
  limit?: number;
  cursor?: string | null;
  agentId?: string;
  directory?: string;
}): string {
  const search = new URLSearchParams({ q: params.query });
  if (params.limit) search.set('limit', String(Math.max(1, Math.min(50, params.limit))));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.agentId) search.set('agent_id', params.agentId);
  if (params.directory?.startsWith('/')) search.set('directory', params.directory);
  return `/api/search?${search.toString()}`;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * One search answer, envelope or bare.
 *
 * A malformed row is dropped rather than failing the page: one bad row from a
 * new agent adapter must not blank every other result. Highlights are
 * clamped to the snippet and merged, so the renderer can trust them.
 */
export function parseSessionSearchPage(raw: unknown): SessionSearchPage {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data =
    body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : body;
  const items = Array.isArray(data.items) ? data.items : [];
  const hits: SessionSearchHit[] = [];
  for (const entry of items) {
    const hit = parseHit(entry);
    if (hit) hits.push(hit);
  }
  const indexing =
    data.indexing && typeof data.indexing === 'object'
      ? (data.indexing as Record<string, unknown>)
      : null;
  const done = Number(indexing?.done);
  const total = Number(indexing?.total);
  return {
    hits,
    nextCursor: text(data.next_cursor) ?? null,
    indexing:
      indexing && Number.isFinite(done) && Number.isFinite(total) && total >= 0
        ? { done: Math.max(0, Math.min(done, total)), total }
        : null,
  };
}

function parseHit(entry: unknown): SessionSearchHit | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  const asid = text(row.asid);
  const agentId = text(row.agent_id);
  const itemId = text(row.item_id);
  const snippet = typeof row.snippet === 'string' ? row.snippet : undefined;
  if (!asid || !agentId || !itemId || snippet === undefined) return null;
  const timeMs = Number(row.time_ms);
  const sessionHits = Number(row.session_hits);
  return {
    asid,
    agentId,
    title: typeof row.title === 'string' ? row.title : '',
    directory: text(row.directory),
    parentAsid: text(row.parent_asid),
    itemId,
    messageId: text(row.message_id) ?? itemId,
    role: row.role === 'user' ? 'user' : 'assistant',
    kind: row.kind === 'tool' ? 'tool' : 'text',
    timeMs: Number.isFinite(timeMs) ? timeMs : 0,
    snippet,
    highlights: normalizeHighlights(row.highlights, snippet.length),
    sessionHits: Number.isFinite(sessionHits) && sessionHits >= 1 ? Math.floor(sessionHits) : 1,
  };
}

function normalizeHighlights(value: unknown, length: number): [number, number][] {
  if (!Array.isArray(value)) return [];
  const ranges: [number, number][] = [];
  for (const range of value) {
    if (!Array.isArray(range) || range.length < 2) continue;
    const start = Math.max(0, Math.floor(Number(range[0])));
    const end = Math.min(length, Math.floor(Number(range[1])));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export interface SnippetSegment {
  text: string;
  hit: boolean;
}

/** The snippet cut at its highlights, for nested `<Text>` runs. */
export function snippetSegments(
  snippet: string,
  highlights: SessionSearchHit['highlights']
): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let at = 0;
  for (const [start, end] of highlights) {
    if (start < at || end > snippet.length) continue;
    if (start > at) segments.push({ text: snippet.slice(at, start), hit: false });
    segments.push({ text: snippet.slice(start, end), hit: true });
    at = end;
  }
  if (at < snippet.length) segments.push({ text: snippet.slice(at), hit: false });
  return segments;
}

/** One session's hits, as the gateway listed them together. */
export interface SessionSearchGroup {
  key: string;
  serverId: string;
  hits: ServerSessionSearchHit[];
  /** Matches in the session the rows below do not show. */
  more: number;
}

/**
 * Several computers' pages as one list of sessions.
 *
 * Each gateway ranks its own hits, and the scores are not comparable across
 * gateways (each computer's bm25 statistics are its own), so the merge keeps
 * every computer's order and interleaves them by rank: the best session of
 * each computer first, then the second of each. Within a rank, the session
 * whose best hit is newer goes first. A session's hits stay together.
 */
export function mergeSessionSearchPages(
  pages: readonly { serverId: string; hits: readonly SessionSearchHit[] }[]
): SessionSearchGroup[] {
  const perServer = pages.map(({ serverId, hits }) => groupHits(serverId, hits));
  const merged: SessionSearchGroup[] = [];
  const longest = Math.max(0, ...perServer.map((groups) => groups.length));
  for (let rank = 0; rank < longest; rank++) {
    const tier = perServer.flatMap((groups) => (groups[rank] ? [groups[rank]] : []));
    tier.sort((a, b) => b.hits[0].timeMs - a.hits[0].timeMs);
    merged.push(...tier);
  }
  return merged;
}

function groupHits(serverId: string, hits: readonly SessionSearchHit[]): SessionSearchGroup[] {
  const groups = new Map<string, SessionSearchGroup>();
  for (const hit of hits) {
    const key = `${serverId}\u0000${hit.asid}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, serverId, hits: [], more: 0 };
      groups.set(key, group);
    }
    // A later page can repeat a row the first one listed; once is enough.
    if (group.hits.some((known) => known.itemId === hit.itemId)) continue;
    group.hits.push({ ...hit, serverId });
  }
  for (const group of groups.values())
    group.more = Math.max(
      0,
      Math.max(...group.hits.map((hit) => hit.sessionHits)) - group.hits.length
    );
  return [...groups.values()];
}

/** All searched computers' progress together, or null once every index is current. */
export function sessionSearchIndexing(
  pages: readonly (SessionSearchIndexing | null)[]
): SessionSearchIndexing | null {
  let done = 0;
  let total = 0;
  for (const page of pages) {
    if (!page) continue;
    done += page.done;
    total += page.total;
  }
  return done < total ? { done, total } : null;
}

/**
 * The drawn row a hit lands on: the group holding its timeline item, else the
 * group holding any part of its message (the item may have been re-keyed, or
 * merged into a user bubble). Undefined while that row is not loaded.
 */
export function revealRowKey(
  keys: readonly string[],
  rows: Readonly<Record<string, TimelineRenderGroup>>,
  itemId: string,
  messageId: string
): string | undefined {
  let byMessage: string | undefined;
  for (const key of keys) {
    const items = rows[key]?.items;
    if (!items) continue;
    if (items.some((item) => item.id === itemId)) return key;
    if (!byMessage && items.some((item) => item.message_id === messageId)) byMessage = key;
  }
  return byMessage;
}
