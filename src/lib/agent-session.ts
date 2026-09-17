import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import {
  gatewayAuthHeaders,
  gatewayFetch,
  gatewayUrl,
  isGatewayConfigured,
} from './gateway-client';
import { ServerSentEventParser } from './sse-stream';
import type { FileMentionHit } from './file-mentions';
import { activeLocaleHeaders } from '@/i18n/active-locale';
import {
  buildAgentCacheKey,
  CATALOG_TTL_MS,
  dedupeInFlight,
  getCachedAgentCatalogSync,
  getCachedAgentProjectsSync,
  getCachedEntry,
  PROJECTS_TTL_MS,
  setCachedEntry,
  touchCacheEntryTimestamp,
} from './agent-cache';
import {
  EMPTY_CATALOG,
  parseAgentCatalog,
  parseAgentContextUsage,
  parseAgentDomainEvent,
  parseAgentEngineInfo,
  parseAgentSessionInfo,
  parseAgentSessionList,
  parseAgentSessionSnapshot,
  parseFileDiffItems,
  parseInboxItems,
  parseShellList,
  parseShellOutputPage,
  parseTimelineItems,
  parseRunStatus,
  sortTimeline,
  type AgentCatalog,
  type AgentContextUsage,
  type AgentDomainEvent,
  type AgentEngineInfo,
  type AgentRunStatus,
  type AgentSessionInfo,
  type AgentSessionSnapshot,
  type FileDiffItem,
  type InboxItem,
  type ModelRef,
  type PermissionDecision,
  type ShellInfo,
  type ShellOutputPage,
  type TimelineItem,
  type VcsDiffMode,
} from './agent-protocol';

export { getCachedAgentCatalogSync, getCachedAgentProjectsSync, buildAgentCacheKey };

/**
 * The wire contract lives in `agent-protocol.ts`, which has no React Native
 * import in it and is therefore unit-testable. This module is the transport:
 * one function per route in `docs/agent-api.md`, each one handing the response
 * body to a parser that takes `unknown` and never throws.
 */
export * from './agent-protocol';

export interface AgentProject {
  id: string;
  canonical: string;
  name: string;
  vcs?: string;
  sandboxes?: string[];
}

export interface DirectoryItem {
  name: string;
  path: string;
}

export function gatewaySupportsAgentSessions(capabilities: string[] | undefined | null): boolean {
  if (!Array.isArray(capabilities)) return false;
  return capabilities.includes('agent_sessions');
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * `/api/agent-sessions/{asid}{tail}`, or the legacy session-scoped spelling.
 *
 * Every `/api/agent-*` route also exists under `/api/sessions/{id}/agent-*`
 * for the calls that had that form before v2; the `session_id` is parsed and
 * ignored. Routes added for v2 parity are on the global path only, so they
 * pass `legacy: false` and never mention a gateway session.
 */
function sessionRoute(asid: string, tail = '', sessionId?: string, legacy = false): string {
  const base = `/agent-sessions/${encodeURIComponent(asid)}${tail}`;
  return legacy && sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}${base}`
    : `/api${base}`;
}

function jsonHeaders(): Record<string, string> {
  return { ...gatewayAuthHeaders(), 'Content-Type': 'application/json' };
}

/** The `data` of the gateway's envelope, or the body when it has none. */
function envelopeData(json: unknown): unknown {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'data' in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

/**
 * A read that answers with a value, or with `fallback`.
 *
 * Reads never throw: a picker with nothing in it is a worse answer than a
 * stale one, and both are better than a red screen on a phone.
 */
async function readJson<T>(
  path: string,
  parse: (value: unknown) => T,
  fallback: T,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
): Promise<T> {
  try {
    if (!isGatewayConfigured()) return fallback;
    const res = await gatewayFetch(gatewayUrl(path), {
      method: 'GET',
      headers: init?.headers ?? gatewayAuthHeaders(),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (!res.ok) return fallback;
    return parse(envelopeData(await res.json()));
  } catch {
    return fallback;
  }
}

/**
 * A write, which throws on refusal so the caller can say what went wrong.
 *
 * Every call site catches; that is checked by the fact that none of them is a
 * bare `void`. The message carries the gateway's body because
 * `formatAgentErrorMessage` reads it to recognise an offline engine.
 */
async function writeJson(
  path: string,
  what: string,
  body?: unknown,
  method: 'POST' | 'DELETE' = 'POST'
): Promise<unknown> {
  const res = await gatewayFetch(gatewayUrl(path), {
    method,
    headers: body === undefined ? gatewayAuthHeaders() : jsonHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    throw new Error(`${what}: ${res.status} ${await res.text()}`);
  }
  try {
    return envelopeData(await res.json());
  } catch {
    // `204 No Content` is a legitimate answer to several of these.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export interface ListAgentSessionsQuery {
  directory?: string;
  parent_id?: string;
  /** `true` lists top-level sessions only — no subagent sessions. */
  roots?: boolean;
  limit?: number;
  order?: 'asc' | 'desc';
  search?: string;
  cursor?: string;
}

function listQuery(query: ListAgentSessionsQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.directory) params.set('directory', query.directory);
  if (query.parent_id) params.set('parent_id', query.parent_id);
  if (query.roots) params.set('roots', 'true');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.order) params.set('order', query.order);
  if (query.search) params.set('search', query.search);
  if (query.cursor) params.set('cursor', query.cursor);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export async function listAgentSessions(
  sessionId?: string,
  query?: ListAgentSessionsQuery
): Promise<AgentSessionInfo[]> {
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions${listQuery(query)}`
    : `/api/agent-sessions${listQuery(query)}`;
  return readJson(path, parseAgentSessionList, []);
}

/** The children of one session, in the same shape as the list route. */
export async function listAgentSessionChildren(
  asid: string,
  query?: Omit<ListAgentSessionsQuery, 'parent_id' | 'roots'>
): Promise<AgentSessionInfo[]> {
  if (!asid) return [];
  return readJson(
    `${sessionRoute(asid, '/children')}${listQuery(query)}`,
    parseAgentSessionList,
    []
  );
}

export async function createAgentSession(
  sessionId: string | undefined,
  params: {
    agent?: string;
    model?: ModelRef;
    directory?: string;
  }
): Promise<AgentSessionInfo> {
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions`
    : '/api/agent-sessions';
  // Omitting `model` is the correct way to get the user's configured default;
  // the gateway no longer substitutes one, and neither does this.
  const body: Record<string, unknown> = {};
  if (params.directory) body.directory = params.directory;
  if (params.model) body.model = params.model;
  if (params.agent) body.agent = params.agent;
  const data = await writeJson(path, 'Failed to create agent session', body);
  const info = parseAgentSessionInfo(data);
  if (!info) throw new Error('Failed to create agent session: unreadable response');
  return info;
}

export async function getAgentSessionSnapshot(
  sessionId: string | undefined,
  asid: string
): Promise<AgentSessionSnapshot> {
  const res = await gatewayFetch(gatewayUrl(sessionRoute(asid, '', sessionId, true)), {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get agent session: ${res.status} ${await res.text()}`);
  }
  return parseAgentSessionSnapshot(envelopeData(await res.json()));
}

export async function deleteAgentSession(asid: string): Promise<void> {
  await writeJson(sessionRoute(asid), 'Failed to delete session', undefined, 'DELETE');
}

export async function renameAgentSession(asid: string, title: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/rename'), 'Failed to rename session', { title });
}

/** Marks the session read. Unread is `time_idle > time_viewed`. */
export async function markAgentSessionViewed(asid: string, idle?: number): Promise<void> {
  await writeJson(
    sessionRoute(asid, '/view'),
    'Failed to mark session viewed',
    idle === undefined ? {} : { idle }
  );
}

/** The exported transcript, for a share sheet. There is no sharing in v2. */
export async function exportAgentSession(asid: string, sanitize = true): Promise<unknown> {
  return readJson(
    `${sessionRoute(asid, '/export')}?sanitize=${sanitize ? 'true' : 'false'}`,
    (value) => value,
    null
  );
}

// ---------------------------------------------------------------------------
// Prompting and control
// ---------------------------------------------------------------------------

export type AgentDelivery = 'steer' | 'queue';

export async function sendAgentPrompt(
  sessionId: string | undefined,
  asid: string,
  params: {
    text: string;
    attachments?: string[];
    delivery?: AgentDelivery;
  }
): Promise<void> {
  // There is no model or agent field on a prompt: both are session state in
  // v2. Switch first, then prompt.
  const body: Record<string, unknown> = { text: params.text };
  if (params.attachments && params.attachments.length > 0) body.attachments = params.attachments;
  if (params.delivery) body.delivery = params.delivery;
  await writeJson(sessionRoute(asid, '/prompt', sessionId, true), 'Failed to send prompt', body);
}

/** A slash command from the catalog's `commands`. */
export async function sendAgentCommand(
  asid: string,
  params: { name: string; arguments?: string; delivery?: AgentDelivery }
): Promise<void> {
  const body: Record<string, unknown> = { name: params.name.replace(/^\//, '') };
  if (params.arguments) body.arguments = params.arguments;
  if (params.delivery) body.delivery = params.delivery;
  await writeJson(sessionRoute(asid, '/command'), 'Failed to run command', body);
}

export async function abortAgentSession(
  sessionId: string | undefined,
  asid: string
): Promise<void> {
  await writeJson(sessionRoute(asid, '/abort', sessionId, true), 'Failed to abort session');
}

/**
 * Detaches the foreground tools blocking the agent loop — a long `shell` is
 * the usual one. They keep running and stay readable through `/api/agent-shells`.
 */
export async function backgroundAgentSession(asid: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/background'), 'Failed to background tools');
}

export async function switchAgentModel(
  sessionId: string | undefined,
  asid: string,
  model: ModelRef
): Promise<void> {
  await writeJson(sessionRoute(asid, '/model', sessionId, true), 'Failed to switch agent model', {
    model,
  });
}

/** Agent ids are lowercase; OpenCode rejects a display name such as `Build`. */
export async function switchAgentMode(asid: string, agent: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/agent'), 'Failed to switch agent', {
    agent: agent.toLowerCase(),
  });
}

export async function revertAgentSession(
  sessionId: string | undefined,
  asid: string,
  messageId: string
): Promise<void> {
  await writeJson(sessionRoute(asid, '/revert', sessionId, true), 'Failed to revert session', {
    message_id: messageId,
  });
}

/** Cancels a staged rollback — this is redo. */
export async function clearAgentRevert(asid: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/revert/clear'), 'Failed to clear revert');
}

// ---------------------------------------------------------------------------
// Compaction and context
// ---------------------------------------------------------------------------

/**
 * Asks for a compaction. It is admitted to the inbox and runs at the next step
 * boundary; progress arrives as `agent.compaction.changed`, and the finished
 * boundary lands in the timeline as a `compaction` row.
 *
 * This is the real route, not `/compact` typed into the composer.
 */
export async function compactAgentSession(
  asid: string,
  delivery: AgentDelivery = 'steer'
): Promise<void> {
  await writeJson(sessionRoute(asid, '/compact'), 'Failed to compact session', { delivery });
}

/** Everything still in the model's context, i.e. after the last compaction. */
export async function getAgentContext(asid: string): Promise<AgentContextUsage> {
  return readJson(sessionRoute(asid, '/context'), parseAgentContextUsage, {
    messages: 0,
    tokens: null,
  });
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export async function listAgentInbox(asid: string): Promise<InboxItem[]> {
  if (!asid) return [];
  return readJson(sessionRoute(asid, '/inbox'), parseInboxItems, []);
}

export async function cancelAgentInboxItem(asid: string, inboxId: string): Promise<void> {
  await writeJson(
    sessionRoute(asid, `/inbox/${encodeURIComponent(inboxId)}`),
    'Failed to cancel queued item',
    undefined,
    'DELETE'
  );
}

export async function setAgentInboxDelivery(
  asid: string,
  inboxId: string,
  delivery: AgentDelivery
): Promise<void> {
  await writeJson(
    sessionRoute(asid, `/inbox/${encodeURIComponent(inboxId)}/${delivery}`),
    'Failed to change delivery'
  );
}

// ---------------------------------------------------------------------------
// Permissions and forms
// ---------------------------------------------------------------------------

export async function replyAgentPermission(
  sessionId: string | undefined,
  asid: string,
  permissionId: string,
  decision: PermissionDecision,
  message?: string
): Promise<void> {
  await writeJson(
    sessionRoute(asid, `/permissions/${encodeURIComponent(permissionId)}/reply`, sessionId, true),
    'Failed to reply permission',
    message ? { decision, message } : { decision }
  );
}

export async function replyAgentForm(
  sessionId: string | undefined,
  asid: string,
  formId: string,
  answers: Record<string, unknown>
): Promise<void> {
  await writeJson(
    sessionRoute(asid, `/forms/${encodeURIComponent(formId)}/reply`, sessionId, true),
    'Failed to reply form',
    { answers }
  );
}

// ---------------------------------------------------------------------------
// Files, diff, catalog, projects
// ---------------------------------------------------------------------------

export async function listAgentFiles(
  sessionId?: string,
  asid?: string,
  query?: string,
  limit = 20
): Promise<FileMentionHit[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('limit', String(limit));
  const q = `?${params.toString()}`;
  const path = asid
    ? `${sessionRoute(asid, '/files', sessionId, true)}${q}`
    : sessionId
      ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-files${q}`
      : `/api/agent-files${q}`;
  return readJson(
    path,
    (value) => (Array.isArray(value) ? (value as FileMentionHit[]) : []),
    [] as FileMentionHit[]
  );
}

/**
 * What the agent changed on disk.
 *
 * `mode` is required by OpenCode — omitting it is why this used to come back
 * empty — and is the segmented control in the diff sheet.
 */
export async function getAgentVcsDiff(
  sessionId: string | undefined,
  asid: string,
  mode: VcsDiffMode = 'working'
): Promise<FileDiffItem[]> {
  if (!asid) return [];
  return readJson(
    `${sessionRoute(asid, '/vcs/diff', sessionId, true)}?mode=${mode}`,
    parseFileDiffItems,
    []
  );
}

export async function getAgentCatalog(
  sessionId?: string,
  endpoint?: { url?: string; token?: string | null },
  options?: { forceRefresh?: boolean }
): Promise<AgentCatalog> {
  const cacheKey = buildAgentCacheKey('catalog', endpoint?.url, sessionId);
  const cached = getCachedEntry<AgentCatalog>(cacheKey);
  const isFresh = cached && Date.now() - cached.timestamp < CATALOG_TTL_MS;

  if (isFresh && !options?.forceRefresh) {
    return cached.data;
  }

  return dedupeInFlight(cacheKey, async () => {
    try {
      const base = endpoint?.url ? endpoint.url.replace(/\/$/, '') : null;
      if (!base && !isGatewayConfigured()) {
        return cached?.data ?? EMPTY_CATALOG;
      }
      const url = base
        ? `${base}${sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-catalog` : '/api/agent-catalog'}`
        : sessionId
          ? gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-catalog`)
          : gatewayUrl('/api/agent-catalog');
      const headers: Record<string, string> = endpoint?.url
        ? {
            ...activeLocaleHeaders(),
            ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
          }
        : gatewayAuthHeaders();

      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      const res = await gatewayFetch(url, { method: 'GET', headers });

      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }

      if (!res.ok) {
        return cached?.data ?? EMPTY_CATALOG;
      }

      const etag = res.headers.get('etag') ?? undefined;
      const catalog = parseAgentCatalog(envelopeData(await res.json()));
      setCachedEntry(cacheKey, catalog, etag);
      return catalog;
    } catch (err) {
      console.warn('Failed to get agent catalog:', err);
      return cached?.data ?? EMPTY_CATALOG;
    }
  });
}

export async function getAgentProjects(
  sessionId?: string,
  endpoint?: { url?: string; token?: string | null },
  options?: { forceRefresh?: boolean }
): Promise<AgentProject[]> {
  const cacheKey = buildAgentCacheKey('projects', endpoint?.url, sessionId);
  const cached = getCachedEntry<AgentProject[]>(cacheKey);
  const isFresh = cached && Date.now() - cached.timestamp < PROJECTS_TTL_MS;

  if (isFresh && !options?.forceRefresh) {
    return cached.data;
  }

  return dedupeInFlight(cacheKey, async () => {
    try {
      const base = endpoint?.url ? endpoint.url.replace(/\/$/, '') : null;
      if (!base && !isGatewayConfigured()) return cached?.data ?? [];
      const url = base
        ? `${base}${sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-projects` : '/api/agent-projects'}`
        : sessionId
          ? gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-projects`)
          : gatewayUrl('/api/agent-projects');
      const headers: Record<string, string> = endpoint?.url
        ? {
            ...activeLocaleHeaders(),
            ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
          }
        : gatewayAuthHeaders();

      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      const res = await gatewayFetch(url, { method: 'GET', headers });

      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }

      if (!res.ok) {
        return cached?.data ?? [];
      }

      const etag = res.headers.get('etag') ?? undefined;
      const data = envelopeData(await res.json());
      const projects = Array.isArray(data) ? (data as AgentProject[]) : [];
      setCachedEntry(cacheKey, projects, etag);
      return projects;
    } catch {
      return cached?.data ?? [];
    }
  });
}

export async function getAgentDirectories(
  prefix?: string,
  query?: string,
  sessionId?: string
): Promise<DirectoryItem[]> {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  if (query) params.set('query', query);
  const q = params.toString() ? `?${params.toString()}` : '';
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-directories${q}`
    : `/api/agent-directories${q}`;
  return readJson(
    path,
    (value) => (Array.isArray(value) ? (value as DirectoryItem[]) : []),
    [] as DirectoryItem[]
  );
}

// ---------------------------------------------------------------------------
// Background shells
// ---------------------------------------------------------------------------

export async function listAgentShells(directory?: string): Promise<ShellInfo[]> {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : '';
  return readJson(`/api/agent-shells${q}`, parseShellList, []);
}

export async function getAgentShellOutput(
  shellId: string,
  options?: { cursor?: number; limit?: number }
): Promise<ShellOutputPage> {
  const params = new URLSearchParams();
  if (options?.cursor !== undefined) params.set('cursor', String(options.cursor));
  if (options?.limit !== undefined) params.set('limit', String(options.limit));
  const q = params.toString() ? `?${params.toString()}` : '';
  return readJson(
    `/api/agent-shells/${encodeURIComponent(shellId)}/output${q}`,
    parseShellOutputPage,
    { output: '', cursor: options?.cursor ?? 0, size: 0, truncated: false }
  );
}

export async function killAgentShell(shellId: string): Promise<void> {
  await writeJson(
    `/api/agent-shells/${encodeURIComponent(shellId)}`,
    'Failed to stop shell',
    undefined,
    'DELETE'
  );
}

// ---------------------------------------------------------------------------
// Engine status
// ---------------------------------------------------------------------------

/** The one agent route that answers 200 with no engine attached. */
export async function getAgentEngine(): Promise<AgentEngineInfo> {
  return readJson('/api/agent-engine', parseAgentEngineInfo, {
    available: false,
    origin: 'none',
    stream_connected: false,
    autostart: true,
  });
}

// ---------------------------------------------------------------------------
// Timeline delta and stream
// ---------------------------------------------------------------------------

export interface AgentTimelineDelta {
  items: TimelineItem[];
  status?: AgentRunStatus;
  resync: boolean;
  latest_seq: number;
}

/**
 * Whatever the stream missed while it was down.
 *
 * The SSE connection is the live channel; this is the gap filler a reconnect
 * asks for, and a `resync` answer is the gateway saying the requested point
 * has fallen out of its ring buffer and the snapshot must be refetched.
 */
export async function getAgentTimelineDelta(
  sessionId: string | undefined,
  asid: string,
  afterSeq: number
): Promise<AgentTimelineDelta> {
  return readJson(
    `${sessionRoute(asid, '/timeline', sessionId, true)}?after=${afterSeq}`,
    (value) => {
      const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      return {
        items: sortTimeline(parseTimelineItems(rec.items)),
        ...(typeof rec.status === 'string' ? { status: parseRunStatus(rec.status) } : {}),
        resync: rec.resync === true,
        latest_seq: typeof rec.latest_seq === 'number' ? rec.latest_seq : afterSeq,
      };
    },
    { items: [], resync: false, latest_seq: afterSeq }
  );
}

export function openAgentSessionStream(options: {
  asid: string;
  sessionId?: string;
  /** Already parsed and validated; an unrecognised frame never arrives here. */
  onEvent: (event: AgentDomainEvent) => void;
  onError?: (err: unknown) => void;
  onConnected?: () => void;
}): () => void {
  let cancelled = false;
  const controller = new AbortController();

  const connect = async () => {
    try {
      if (!isGatewayConfigured()) {
        options.onError?.(new Error('Gateway not configured'));
        return;
      }
      const url = gatewayUrl(sessionRoute(options.asid, '/stream', options.sessionId, true));
      const headers = gatewayAuthHeaders();
      const decoder = new TextDecoder();
      const parser = new ServerSentEventParser();

      const response = await nitroFetch(url, {
        headers: {
          ...headers,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
        stream: true,
      });

      if (!response.ok) throw new Error(`Agent stream HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Agent stream body not readable');

      options.onConnected?.();

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done || cancelled) break;
        if (!value) continue;
        const text = decoder.decode(value, { stream: true });
        for (const frame of parser.push(text)) {
          let data: unknown = frame.data;
          try {
            data = JSON.parse(frame.data);
          } catch {
            // A frame that is not JSON is still named, and `connected` is one
            // of those; the parser below decides whether it means anything.
          }
          const event = parseAgentDomainEvent(frame.event, data);
          if (event) options.onEvent(event);
        }
      }
    } catch (err) {
      if (!cancelled) {
        options.onError?.(err);
      }
    }
  };

  void connect().catch((err) => {
    if (!cancelled) options.onError?.(err);
  });

  return () => {
    cancelled = true;
    controller.abort();
  };
}
