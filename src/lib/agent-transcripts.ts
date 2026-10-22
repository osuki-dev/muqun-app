/**
 * Read-only transcripts of terminal agents, paged from the Gateway.
 *
 * A terminal agent such as Claude Code keeps no scrollback the App can page
 * (it repaints its screen), but writes its whole conversation to disk. A
 * Gateway with `agent_transcripts_v1` reads that file and serves it as the
 * same timeline items an OpenCode or Codex session has, so the App draws it
 * with the transcript components it already owns. Which agents have a reader
 * is the Gateway's `agent_transcripts` list, never a guess from a version.
 *
 * The wire: `GET /api/agents/transcripts/{agent}/{session_id}` returns one
 * page of items, oldest first, walking back from the newest entry;
 * `before` is the cursor of the page before it and `limit` its size. The
 * `head` route is the cheap probe: the file's line and byte counts, which
 * change when the agent writes more.
 *
 * This module is the pure part -- capability tokens, wire parsing, the merge
 * rules and the reader state machine -- so paging, cursors and the head
 * poll can be tested without a device. The network lives in
 * `agent-transcripts-client.ts`.
 */

import { asRecord, parseTimelineItems, sortTimeline, type TimelineItem } from './agent-protocol';

/** The Gateway serves `GET /api/agents/transcripts/{agent}/{session_id}`. */
export const AGENT_TRANSCRIPTS_CAPABILITY = 'agent_transcripts_v1';
/**
 * The Gateway's `agent_transcripts` list, mirrored into the capability index
 * as one token per reader (`agent_transcripts:claude`), so the Home screen
 * can answer "does this computer read Claude transcripts" from the same
 * mirror that answers every other capability question.
 */
export const TRANSCRIPT_READER_PREFIX = 'agent_transcripts:';
const MAX_AGENT_NAME = 32;

/** The readers a `/health` or `/api/discovery` answer names, as mirror tokens. */
export function transcriptReaderTokens(answer: unknown): string[] {
  const body = asRecord(answer);
  const capabilities = body?.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes(AGENT_TRANSCRIPTS_CAPABILITY))
    return [];
  const readers = body?.agent_transcripts;
  if (!Array.isArray(readers)) return [];
  const tokens: string[] = [];
  for (const agent of readers) {
    if (typeof agent !== 'string') continue;
    const name = agent.trim();
    if (!name || name.length > MAX_AGENT_NAME || tokens.includes(TRANSCRIPT_READER_PREFIX + name))
      continue;
    tokens.push(TRANSCRIPT_READER_PREFIX + name);
  }
  return tokens;
}

export type TranscriptAvailability =
  /** The Gateway reads this agent's transcripts. */
  | 'available'
  /** The Gateway predates transcript reading. */
  | 'gateway-upgrade'
  /** The Gateway reads transcripts, but has no reader for this agent. */
  | 'agent-unsupported';

export function transcriptAvailability(
  capabilities: readonly string[] | undefined,
  agent: string
): TranscriptAvailability {
  if (!capabilities?.includes(AGENT_TRANSCRIPTS_CAPABILITY)) return 'gateway-upgrade';
  return capabilities.includes(TRANSCRIPT_READER_PREFIX + agent)
    ? 'available'
    : 'agent-unsupported';
}

/** What Herdr knows of the agent in a pane: its name and its own session id. */
export interface AgentSessionRef {
  /** Herdr's `agent_session.agent`: the transcript route's `{agent}` segment. */
  agent: string;
  /** Herdr's `agent_session.value`: the agent's own session id. */
  sessionId: string;
}

const MAX_SESSION_ID = 128;

/**
 * The `agent_session` of a Herdr agent entity, when it names a session id.
 * Herdr reports a Claude Code pane as
 * `{ agent: 'claude', kind: 'id', source: 'herdr:claude', value: '<uuid>' }`.
 */
export function agentSessionOf(
  raw: Record<string, unknown> | null | undefined
): AgentSessionRef | null {
  const session = asRecord(raw?.agent_session);
  if (!session) return null;
  const agent = typeof session.agent === 'string' ? session.agent.trim() : '';
  const sessionId = typeof session.value === 'string' ? session.value.trim() : '';
  if (session.kind !== undefined && session.kind !== 'id') return null;
  if (!agent || agent.length > MAX_AGENT_NAME || !sessionId || sessionId.length > MAX_SESSION_ID)
    return null;
  return { agent, sessionId };
}

export interface TranscriptRoute {
  /** Herdr's `agent_session.agent`. */
  agent: string;
  /** Herdr's `agent_session.value`. */
  sessionId: string;
  /** The pane's working directory, a hint that narrows the Gateway's search. */
  cwd?: string;
}

/** `GET /api/agents/transcripts/{agent}/{session_id}` or its `/head`, with the query. */
export function transcriptPath(
  route: TranscriptRoute,
  tail: '' | '/head',
  query: Record<string, string>
): string {
  const search = Object.entries({ ...(route.cwd ? { cwd: route.cwd } : {}), ...query })
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return (
    `/api/agents/transcripts/${encodeURIComponent(route.agent)}/${encodeURIComponent(route.sessionId)}` +
    `${tail}${search ? `?${search}` : ''}`
  );
}

/** The transcript file's size, as the `head` probe and every page report it. */
export interface TranscriptHead {
  /** Complete lines in the file. */
  lines: number;
  /** Lines pages are made of. */
  entries: number;
  bytes: number;
}

export interface TranscriptPage {
  items: TimelineItem[];
  hasMore: boolean;
  /** The cursor of the page before this one; `null` at the oldest entry. */
  nextBefore: string | null;
  head: TranscriptHead;
}

export function parseTranscriptHead(value: unknown): TranscriptHead | null {
  const head = asRecord(value);
  if (!head) return null;
  const count = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : null;
  const lines = count(head.lines);
  const entries = count(head.entries);
  const bytes = count(head.bytes);
  if (lines === null || entries === null || bytes === null) return null;
  return { lines, entries, bytes };
}

/** The page inside a content envelope (`{ data }`) or bare. */
export function parseTranscriptPage(value: unknown): TranscriptPage {
  const envelope = asRecord(value);
  const page = asRecord(envelope?.data) ?? envelope;
  const head = parseTranscriptHead(page?.head);
  if (!page || !Array.isArray(page.items) || !head) throw new Error('Invalid transcript page');
  const nextBefore =
    typeof page.next_before === 'string' && page.next_before.length > 0 ? page.next_before : null;
  return {
    items: sortTimeline(parseTimelineItems(page.items)),
    hasMore: page.has_more === true && nextBefore !== null,
    nextBefore,
    head,
  };
}

/**
 * Whether the file grew (or was replaced) since `known`: the cue to fetch the
 * newest page again. Bytes and not only entries, because a line that is not
 * an entry can still change what is drawn -- a tool result answers an earlier
 * call. The modification time alone is not a change.
 */
export function transcriptHeadChanged(known: TranscriptHead | null, head: TranscriptHead): boolean {
  if (!known) return true;
  return known.lines !== head.lines || known.entries !== head.entries || known.bytes !== head.bytes;
}

/**
 * The timeline with a page merged in: one item per id, the incoming copy
 * winning (a tool call answered since it was first read changes state), in
 * timeline order. The same array comes back when the page changed nothing,
 * so the rows built from it are kept.
 */
export function mergeTranscriptItems(
  existing: readonly TimelineItem[],
  incoming: readonly TimelineItem[]
): TimelineItem[] {
  if (incoming.length === 0) return existing as TimelineItem[];
  const byId = new Map(existing.map((item) => [item.id, item]));
  let changed = false;
  const merged = [...existing];
  for (const item of incoming) {
    const held = byId.get(item.id);
    if (held && sameTranscriptItem(held, item)) continue;
    changed = true;
    if (held) merged[merged.indexOf(held)] = item;
    else merged.push(item);
    byId.set(item.id, item);
  }
  return changed ? sortTimeline(merged) : (existing as TimelineItem[]);
}

function sameTranscriptItem(a: TimelineItem, b: TimelineItem): boolean {
  if (a === b) return true;
  if (a.seq !== b.seq || a.updated_ms !== b.updated_ms || a.role !== b.role) return false;
  return JSON.stringify(a.part) === JSON.stringify(b.part);
}

/** Why a read was refused, as the Gateway's error code. */
export class TranscriptReadError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code
  ) {
    super(message);
    this.name = 'TranscriptReadError';
  }
}

/** The cursor no longer names a place in this file: start again from the newest page. */
const CURSOR_CODES = new Set(['transcript_cursor_gone', 'invalid_cursor']);
/** There is no transcript to read: not an error worth retrying. */
const MISSING_CODES = new Set(['transcript_not_found', 'transcript_agent_unsupported']);

export interface TranscriptReaderState {
  /** Oldest first, one per id. */
  items: TimelineItem[];
  /** The first page has answered, or failed to. */
  loaded: boolean;
  /** An older page is on its way. */
  loadingOlder: boolean;
  /** Entries older than `items[0]` exist. */
  hasMore: boolean;
  /** The newest read failed; `items` is what was read before. */
  failed: boolean;
  /** The Gateway has no transcript for this session. */
  missing: boolean;
  /** The file as last seen. */
  head: TranscriptHead | null;
}

export interface TranscriptPageQuery {
  before?: string;
  limit: number;
}

export interface TranscriptReaderSource {
  page: (query: TranscriptPageQuery, signal: AbortSignal) => Promise<TranscriptPage>;
  head: (signal: AbortSignal) => Promise<TranscriptHead>;
}

export interface TranscriptReader {
  /** Read the newest page, replacing whatever was held. */
  open: () => Promise<void>;
  /** Read the page before the oldest one held, if any. */
  loadOlder: () => Promise<void>;
  /**
   * Probe the head and, when the file changed, read the newest page again.
   * New entries are appended behind what is held; the older cursor is kept.
   */
  check: () => Promise<void>;
  getState: () => TranscriptReaderState;
  dispose: () => void;
}

export const DEFAULT_TRANSCRIPT_PAGE_SIZE = 40;
/**
 * How many pages a check follows back from the newest to meet what it already
 * holds. Past that the held items are let go and the newest pages stand on
 * their own, rather than drawing a transcript with a hole in it.
 */
const MAX_CATCH_UP_PAGES = 3;

export const INITIAL_TRANSCRIPT_STATE: TranscriptReaderState = {
  items: [],
  loaded: false,
  loadingOlder: false,
  hasMore: false,
  failed: false,
  missing: false,
  head: null,
};

/**
 * One transcript's reader: it owns its requests and cursors, and runs one
 * read at a time. Disposing it prevents every late publication.
 */
export function createTranscriptReader(
  source: TranscriptReaderSource,
  publish: (state: TranscriptReaderState) => void,
  options: { pageSize?: number } = {}
): TranscriptReader {
  const limit = options.pageSize ?? DEFAULT_TRANSCRIPT_PAGE_SIZE;
  let state = INITIAL_TRANSCRIPT_STATE;
  let alive = true;
  let request: AbortController | null = null;
  /** Cursors already asked for, so a page that repeats one ends the walk. */
  const seenCursors = new Set<string>();

  const set = (patch: Partial<TranscriptReaderState>) => {
    if (!alive) return;
    state = { ...state, ...patch };
    publish(state);
  };
  const begin = () => {
    const controller = new AbortController();
    request = controller;
    return controller;
  };
  const current = (controller: AbortController) =>
    alive && request === controller && !controller.signal.aborted;

  /** The cursor of the page before the oldest held item. */
  let cursor: string | null = null;

  const open = async () => {
    request?.abort();
    const controller = begin();
    seenCursors.clear();
    try {
      const page = await source.page({ limit }, controller.signal);
      if (!current(controller)) return;
      set({
        items: page.items,
        loaded: true,
        loadingOlder: false,
        hasMore: page.hasMore,
        failed: false,
        missing: false,
        head: page.head,
      });
      cursor = page.nextBefore;
    } catch (error) {
      if (!current(controller)) return;
      set({
        loaded: true,
        loadingOlder: false,
        failed: !isMissing(error),
        missing: isMissing(error),
      });
    } finally {
      if (request === controller) request = null;
    }
  };

  const loadOlder = async () => {
    if (!alive || request || !state.loaded || !state.hasMore || !cursor) return;
    const before = cursor;
    if (seenCursors.has(before)) {
      set({ hasMore: false });
      return;
    }
    const controller = begin();
    set({ loadingOlder: true });
    try {
      const page = await source.page({ before, limit }, controller.signal);
      if (!current(controller)) return;
      seenCursors.add(before);
      const repeated =
        page.nextBefore !== null &&
        (page.nextBefore === before || seenCursors.has(page.nextBefore));
      cursor = repeated ? null : page.nextBefore;
      set({
        items: mergeTranscriptItems(state.items, page.items),
        loadingOlder: false,
        hasMore: page.hasMore && !repeated,
        failed: false,
        head: page.head,
      });
    } catch (error) {
      if (!current(controller)) return;
      if (isCursorLost(error)) {
        request = null;
        await open();
        return;
      }
      set({ loadingOlder: false, failed: !isMissing(error), missing: isMissing(error) });
    } finally {
      if (request === controller) request = null;
    }
  };

  const check = async () => {
    if (!alive || request || !state.loaded || state.missing) return;
    const controller = begin();
    try {
      const head = await source.head(controller.signal);
      if (!current(controller)) return;
      if (!transcriptHeadChanged(state.head, head)) {
        if (state.failed) set({ failed: false });
        return;
      }
      // Newest page first, then back through the cursors until a page holds
      // an item already held (or the file's start): everything read merges
      // behind what was held, and the older cursor stays where it was.
      const known = new Set(state.items.map((item) => item.id));
      let items = state.items;
      let before: string | undefined;
      let oldest: TranscriptPage | null = null;
      let met = false;
      for (let pages = 0; pages < MAX_CATCH_UP_PAGES && !met; pages++) {
        const page = await source.page(before ? { before, limit } : { limit }, controller.signal);
        if (!current(controller)) return;
        oldest = page;
        items = mergeTranscriptItems(items, page.items);
        met = !page.hasMore || page.items.some((item) => known.has(item.id));
        if (!page.nextBefore || known.size === 0) break;
        before = page.nextBefore;
      }
      if (!oldest) return;
      if (met) {
        set({ items, failed: false, head: oldest.head });
        return;
      }
      // The pages never reached what was held (or nothing was): a hole would
      // be drawn between the two, so only what was just read is kept, with
      // the oldest read page's cursor.
      seenCursors.clear();
      cursor = oldest.nextBefore;
      set({
        items: items.filter((item) => !known.has(item.id)),
        failed: false,
        hasMore: oldest.hasMore,
        head: oldest.head,
      });
    } catch (error) {
      if (!current(controller)) return;
      if (isCursorLost(error)) {
        request = null;
        await open();
        return;
      }
      set({ failed: !isMissing(error), missing: isMissing(error) });
    } finally {
      if (request === controller) request = null;
    }
  };

  return {
    open,
    loadOlder,
    check,
    getState: () => state,
    dispose: () => {
      alive = false;
      request?.abort();
      request = null;
    },
  };
}

function isCursorLost(error: unknown): boolean {
  return error instanceof TranscriptReadError && CURSOR_CODES.has(error.code);
}

function isMissing(error: unknown): boolean {
  return error instanceof TranscriptReadError && MISSING_CODES.has(error.code);
}
