import { demoStageSnapshot, demoStageSessions, DEMO_STAGE_ASIDS } from './demo-stage-progress';
import { agentSnapshotRefreshQuery } from './agent-session-runtime';
import { DEMO_COMPACTION_LOG_ASIDS, isDemoCompactionLogAsid } from './demo-compaction-log-native';
import { DEMO_NOTICE_ASIDS, isDemoNoticeAsid } from './demo-notification-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { agentSessionListQuery, type ListAgentSessionsQuery } from './agent-session-list-query';
import {
  parseAgentSessionPage,
  supportsAgentSessionPages,
  type AgentSessionPage,
} from './agent-session-page';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import {
  configuredGatewayServerId,
  encryptedEventStreamRequest,
  gatewayAuthHeaders,
  gatewayEndpointFetch,
  gatewayFetch,
  gatewayWriteFetch,
  gatewayUrl,
  isGatewayConfigured,
  type GatewayEndpoint,
} from './gateway-client';
import { streamRecordCrypto } from './gateway-transport';
import { STREAM_WATCHDOG_TICK_MS, streamIsStalled } from './stream-watchdog';
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { connectAgentStream, type AgentStreamResponse } from './agent-stream';
import { isShellNotFoundError } from './agent-shell-errors';
import type { FileMentionHit } from './file-mentions';
import {
  EMPTY_DIRECTORY_LISTING,
  parseDirectoryListing,
  type DirectoryListing,
} from './agent-directory-suggest';
import { activeLocaleHeaders } from '@/i18n/active-locale';
import {
  advanceDemoCompaction,
  DEMO_COMPACTION_ASID,
  DEMO_ITALIC_BOUNDARY_ASID,
  DEMO_NATIVE_PREVIEW_ASID,
  DEMO_NATIVE_PREVIEW_CHILD_ASID,
  DEMO_SERVER_ID,
  demoCompactionSnapshot,
  demoNativePreviewSnapshot,
  demoCompactionLogsSnapshot,
  advanceDemoCompactionLogs,
  subscribeDemoCompactionLogs,
  demoNotificationSnapshot,
  subscribeDemoNotification,
  isDemoActive,
  subscribeDemoCompaction,
} from './demo-gateway';
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
  agentCatalogCacheVariant,
  agentCatalogPath,
  isEmptyAgentCatalog,
  normalizeCatalogDirectory,
} from './agent-catalog-scope';
import {
  hasMultiAgent,
  scopedAgentCacheVariant,
  withAgentIdQuery,
  withScopedAgentId,
} from './agent-discovery';
import {
  asFiniteNumber,
  asRecord,
  EMPTY_CATALOG,
  parseAgentCatalog,
  parseAgentContextUsage,
  parseAgentStatusInfo,
  parseAgentSessionInfo,
  parseAgentSessionList,
  parseAgentSessionRevert,
  parseAgentSessionSnapshot,
  parseAgentVcsDiff,
  parseAgentVcsDiscard,
  parseAgentVcsFilePatch,
  parseAgentVcsFiles,
  parseGatewayDiscovery,
  parseWorkspaceMissing,
  parseInboxItems,
  parseSavedPermissions,
  parseShellList,
  parseShellOutputPage,
  parseTimelineItems,
  parseEarlierTimelinePage,
  parseRunStatus,
  parseCreatedWorktree,
  parseWorktreeList,
  sortTimeline,
  type AgentCatalog,
  type AgentFeatures,
  type AgentContextUsage,
  type AgentProject,
  type AgentDomainEvent,
  type AgentStatusInfo,
  type AgentRunStatus,
  type AgentSessionInfo,
  type AgentSessionRevert,
  type AgentSessionSnapshot,
  type AgentVcsDiff,
  type AgentVcsDiscard,
  type AgentVcsFilePatch,
  type AgentVcsFiles,
  type AgentWorktreeListing,
  type GatewayDiscovery,
  type InboxItem,
  type ModelRef,
  type PermissionDecision,
  type SavedPermission,
  type ShellInfo,
  type ShellOutputPage,
  type TimelineItem,
  type VcsDiffMode,
  type VcsFilesMode,
  type WorkspaceMissing,
  type WorktreeDirectory,
} from './agent-protocol';
import { readApiError } from './gateway-refusal';

export { getCachedAgentCatalogSync, getCachedAgentProjectsSync, buildAgentCacheKey };

/**
 * The wire contract lives in `agent-protocol.ts`, which has no React Native
 * import in it and is therefore unit-testable. This module is the transport:
 * one function per route in `docs/agent-api.md`, each one handing the response
 * body to a parser that takes `unknown` and never throws.
 */
export * from './agent-protocol';

export type { DirectoryItem, DirectoryListing } from './agent-directory-suggest';

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

/** A selected offline record never uses a live agent transport, even for auxiliary reads. */
function usesOfflineDemo(endpoint?: { url?: string }): boolean {
  return (
    configuredGatewayServerId() === DEMO_SERVER_ID &&
    isDemoActive() &&
    (!endpoint?.url || endpoint.url.replace(/\/$/, '') === gatewayUrl(''))
  );
}

/**
 * What the envelope says the gateway can do, filed under the configured
 * server so the next screen can act on it without asking (`observe`).
 */
function observeEnvelopeCapabilities(json: unknown): void {
  const capabilities = asRecord(json)?.capabilities;
  if (capabilities === undefined) return;
  useServerCapabilities.getState().observe(configuredGatewayServerId(), capabilities);
}

/** The `data` of the gateway's envelope, or the body when it has none. */
function envelopeData(json: unknown): unknown {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'data' in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

/**
 * A read that answers with a value, or with `fallback` -- and with the one
 * refusal that is worth repeating to the reader. `parse` gets the envelope's
 * `data` and the whole body, for the routes that answer beside `data`.
 *
 * Reads never throw: a picker with nothing in it is a worse answer than a
 * stale one, and both are better than a red screen on a phone.
 *
 * `workspace_missing` is the only status the transport reads: it is not a
 * fault, it is the ground being gone, and the screen has something to say
 * about it exactly once. Everything else keeps the rule above -- the fallback,
 * and silence.
 */
async function readScoped<T>(
  path: string,
  parse: (value: unknown, envelope: unknown) => T,
  fallback: T,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
): Promise<{ value: T; missing?: WorkspaceMissing }> {
  if (usesOfflineDemo()) return { value: fallback };
  const url = gatewayUrl(path);
  /**
   * One request per path in flight, and everyone waits on the same answer.
   *
   * Opening the agent screen asked the gateway seventeen times in three
   * seconds, and most of those were the *same* GET made twice by two effects
   * that had both just been re-declared. Deduping by the full path is the
   * honest shape of that: two identical reads at the same moment cannot
   * disagree, so there is no reason to make the phone pay for both. A read
   * that has already answered is not deduped -- the map is cleared when the
   * promise settles -- so this is not a cache and nothing goes stale in it.
   *
   * A request with a caller's own `signal` stays its own: sharing one promise
   * would let one caller's abort cancel another's read.
   */
  const run = async (): Promise<{ value: T; missing?: WorkspaceMissing }> => {
    try {
      if (!isGatewayConfigured()) return { value: fallback };
      const res = await gatewayFetch(url, {
        method: 'GET',
        headers: init?.headers ?? gatewayAuthHeaders(),
        ...(init?.signal ? { signal: init.signal } : {}),
      });
      if (!res.ok) {
        const missing = res.status === 404 ? parseWorkspaceMissing(await readBody(res)) : null;
        return missing ? { value: fallback, missing } : { value: fallback };
      }
      const body: unknown = await res.json();
      return { value: parse(envelopeData(body), body) };
    } catch {
      return { value: fallback };
    }
  };
  return init?.signal ? run() : dedupeInFlight(`GET ${url}`, run);
}

/** The body as JSON, or nothing: a refusal is allowed to be unreadable. */
async function readBody(res: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** `readScoped` for the reads that have nothing to say about a missing folder. */
export async function readJson<T>(
  path: string,
  parse: (value: unknown, envelope: unknown) => T,
  fallback: T,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
): Promise<T> {
  return (await readScoped(path, parse, fallback, init)).value;
}

/**
 * A write, which throws on refusal so the caller can say what went wrong.
 *
 * Every call site catches; that is checked by the fact that none of them is a
 * bare `void`. The message carries the gateway's body because
 * `formatAgentErrorMessage` reads it to recognise an offline engine.
 */
export async function writeJson(
  path: string,
  what: string,
  body?: unknown,
  method: 'POST' | 'DELETE' = 'POST'
): Promise<unknown> {
  if (usesOfflineDemo()) {
    if (method === 'POST' && path === sessionRoute(DEMO_COMPACTION_ASID, '/view')) return null;
    if (
      method === 'POST' &&
      [
        DEMO_NATIVE_PREVIEW_ASID,
        DEMO_NATIVE_PREVIEW_CHILD_ASID,
        DEMO_ITALIC_BOUNDARY_ASID,
        ...DEMO_STAGE_ASIDS.filter((asid) => demoStageSnapshot(asid)),
        ...DEMO_NOTICE_ASIDS,
        ...DEMO_COMPACTION_LOG_ASIDS,
      ].some((asid) => path === sessionRoute(asid, '/view'))
    )
      return null;
    throw new Error('Agent writes are not available in the offline demo');
  }
  // Creating a session, prompting and commanding wait on the agent; every
  // other write is a lookup-sized bookkeeping call.
  const fetch = /\/agent-sessions$|\/(prompt|command)$/.test(path)
    ? gatewayWriteFetch
    : gatewayFetch;
  const res = await fetch(gatewayUrl(path), {
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

export type { ListAgentSessionsQuery } from './agent-session-list-query';

export interface ObservedAgentSessionList {
  sessions: AgentSessionInfo[];
  /** Last successful Gateway confirmation; cached fallbacks keep their original time. */
  observedAtMs?: number;
  authoritative?: boolean;
}

/**
 * The roots (or children) the gateway holds, conditionally.
 *
 * This is the biggest thing the agent screen asks for -- twenty kilobytes of
 * JSON, and it is asked for again every time a turn ends -- and almost every
 * one of those answers is the same list it already had. So it carries the
 * ETag the gateway gave it and takes a `304` as "what you have is current",
 * exactly as the catalog and the projects list already do. The cached list is
 * also what a failed read answers with, because a strip that empties itself
 * because one request timed out has told the reader something untrue.
 */
export async function listAgentSessionsObserved(
  sessionId?: string,
  query?: ListAgentSessionsQuery,
  signal?: AbortSignal
): Promise<ObservedAgentSessionList> {
  if (usesOfflineDemo()) return { sessions: demoStageSessions(), authoritative: true };
  const search = agentSessionListQuery(query);
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions${search}`
    : `/api/agent-sessions${search}`;
  // The query is part of the key: a listing scoped to one workspace is not the
  // same resource as the unscoped one, and they must not share an ETag.
  const url = gatewayUrl(path);
  const headers: Record<string, string> = gatewayAuthHeaders();
  const cacheKey = buildAgentCacheKey('sessions', gatewayUrl(''), sessionId, search || 'all');
  const cached = getCachedEntry<AgentSessionInfo[]>(cacheKey);

  const read = async () => {
    try {
      if (!isGatewayConfigured()) {
        return {
          sessions: cached?.data ?? [],
          ...(cached ? { observedAtMs: cached.timestamp } : {}),
        };
      }
      if (cached?.etag) headers['If-None-Match'] = cached.etag;

      const res = await gatewayFetch(url, { method: 'GET', headers, signal });
      if (signal?.aborted) throw new Error('Session list cancelled');
      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return { sessions: cached.data, observedAtMs: Date.now(), authoritative: true };
      }
      if (!res.ok) {
        return {
          sessions: cached?.data ?? [],
          ...(cached ? { observedAtMs: cached.timestamp } : {}),
        };
      }

      const etag = res.headers.get('etag') ?? undefined;
      const list = parseAgentSessionList(envelopeData(await res.json()));
      if (signal?.aborted) throw new Error('Session list cancelled');
      setCachedEntry(cacheKey, list, etag);
      return { sessions: list, observedAtMs: Date.now(), authoritative: true };
    } catch {
      return {
        sessions: cached?.data ?? [],
        ...(cached ? { observedAtMs: cached.timestamp } : {}),
      };
    }
  };
  return signal ? read() : dedupeInFlight(`GET observed ${url}`, read);
}

/** Provider-scoped pagination, with the legacy array reader for unsupported gateways. */
export async function listAgentSessionPage(
  sessionId: string | undefined,
  query: ListAgentSessionsQuery,
  options: {
    serverId: string;
    capabilities?: readonly string[];
    features?: AgentFeatures;
    signal?: AbortSignal;
  }
): Promise<AgentSessionPage> {
  if (configuredGatewayServerId() !== options.serverId || options.signal?.aborted)
    throw new Error('Session list owner changed');
  if (
    usesOfflineDemo() ||
    !supportsAgentSessionPages(options.capabilities, options.features, query.agentId)
  ) {
    // A provider cursor is never sent to the legacy merged inventory.
    const { cursor: _cursor, ...legacyQuery } = query;
    const result = await listAgentSessionsObserved(sessionId, legacyQuery, options.signal);
    return {
      ...result,
      nextCursor: null,
      previousCursor: null,
      paginated: false,
      authoritative: result.authoritative === true,
    };
  }
  const path = `/api/agent-sessions/page${agentSessionListQuery(query)}`;
  const url = gatewayUrl(path);
  const headers = gatewayAuthHeaders();
  const cacheKey = buildAgentCacheKey('sessions', gatewayUrl(''), sessionId, `page:${path}`);
  const cached = getCachedEntry<AgentSessionPage>(cacheKey);
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  const response = await gatewayFetch(url, { method: 'GET', headers, signal: options.signal });
  if (options.signal?.aborted) throw new Error('Session page cancelled');
  if (response.status === 304 && cached) {
    touchCacheEntryTimestamp(cacheKey);
    return { ...cached.data, authoritative: true, observedAtMs: Date.now() };
  }
  if (!response.ok) throw new Error('Session page unavailable');
  const page = parseAgentSessionPage(envelopeData(await response.json()));
  if (options.signal?.aborted) throw new Error('Session page cancelled');
  const result = { ...page, paginated: true, authoritative: true, observedAtMs: Date.now() };
  setCachedEntry(cacheKey, result, response.headers.get('etag') ?? undefined);
  return result;
}

export async function listAgentSessions(
  sessionId?: string,
  query?: ListAgentSessionsQuery
): Promise<AgentSessionInfo[]> {
  return (await listAgentSessionsObserved(sessionId, query)).sessions;
}

/** The children of one session, in the same shape as the list route. */
export interface AgentSessionChildrenInventory {
  children: AgentSessionInfo[];
  /** True only when the Gateway successfully answered this exact inventory request. */
  authoritative: boolean;
}

export async function listAgentSessionChildrenObserved(
  asid: string,
  query?: Omit<ListAgentSessionsQuery, 'parent_id' | 'roots'>
): Promise<AgentSessionChildrenInventory> {
  if (usesOfflineDemo()) return { children: [], authoritative: true };
  if (!asid || !isGatewayConfigured()) return { children: [], authoritative: false };
  const path = `${sessionRoute(asid, '/children')}${agentSessionListQuery(query)}`;
  // Capture endpoint and credentials together. `gatewayFetch` already dedupes
  // GETs by the full URL and headers, so a later gateway selection can neither
  // join this request nor change where it goes.
  const url = gatewayUrl(path);
  const headers = gatewayAuthHeaders();
  try {
    const res = await gatewayFetch(url, { method: 'GET', headers });
    if (!res.ok) return { children: [], authoritative: false };
    const json = await res.json();
    observeEnvelopeCapabilities(json);
    return {
      children: parseAgentSessionList(envelopeData(json)),
      authoritative: true,
    };
  } catch {
    return { children: [], authoritative: false };
  }
}

export interface AgentSessionDescendantsInventory {
  /** Every session under the one asked about, at every depth, flat. */
  descendants: AgentSessionInfo[];
  /** True only when the Gateway successfully answered this exact request. */
  authoritative: boolean;
  /** The gateway stopped short of the whole subtree; deeper levels are unlisted. */
  truncated: boolean;
}

/**
 * A session's whole subtree in one request
 * (`GET /api/agent-sessions/{asid}/descendants`): the same query, auth,
 * envelope and list shape as `/children`, flattened over every depth, with
 * an optional `truncated: true` beside the list when the gateway cut it
 * short. Only for a gateway that advertised `session_descendants`
 * (`SESSION_DESCENDANTS_CAPABILITY`); an older one answers 404, which is
 * reported as not authoritative so the caller walks instead.
 */
export async function listAgentSessionDescendantsObserved(
  asid: string,
  query?: Omit<ListAgentSessionsQuery, 'parent_id' | 'roots'>
): Promise<AgentSessionDescendantsInventory> {
  const none = { descendants: [], authoritative: false, truncated: false };
  if (usesOfflineDemo()) return { ...none, authoritative: true };
  if (!asid || !isGatewayConfigured()) return none;
  const path = `${sessionRoute(asid, '/descendants')}${agentSessionListQuery(query)}`;
  const url = gatewayUrl(path);
  const headers = gatewayAuthHeaders();
  try {
    const res = await gatewayFetch(url, { method: 'GET', headers });
    if (!res.ok) return none;
    const json = await res.json();
    observeEnvelopeCapabilities(json);
    const data = envelopeData(json);
    // `truncated` sits beside the list: inside `data` when the list is wrapped
    // (`{ sessions, truncated }`), beside `data` when the list is `data` itself.
    const truncated =
      (Array.isArray(data) ? asRecord(json)?.truncated : asRecord(data)?.truncated) === true;
    return { descendants: parseAgentSessionList(data), authoritative: true, truncated };
  } catch {
    return none;
  }
}

export async function listAgentSessionChildren(
  asid: string,
  query?: Omit<ListAgentSessionsQuery, 'parent_id' | 'roots'>
): Promise<AgentSessionInfo[]> {
  return (await listAgentSessionChildrenObserved(asid, query)).children;
}

export async function createAgentSession(
  sessionId: string | undefined,
  params: {
    /** The mode (persona) the session starts in; the agent's own default when omitted. */
    mode?: string;
    model?: ModelRef;
    directory?: string;
    /**
     * Which agent owns the new session. Omitted, the gateway's primary
     * takes it -- which is the only agent an older gateway has. A gateway
     * answers `400 invalid_agent` for a name it does not know and
     * `503 agent_unavailable` for one it knows but has not attached.
     */
    agentId?: string;
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
  if (params.mode) body.mode = params.mode;
  if (params.agentId) body.agent_id = params.agentId;
  const data = await writeJson(path, 'Failed to create agent session', body);
  const info = parseAgentSessionInfo(data);
  if (!info) throw new Error('Failed to create agent session: unreadable response');
  return info;
}

/**
 * A session's snapshot from the computer it runs on, whatever this device has
 * selected; `null` when it did not answer.
 */
export async function readAgentSessionAt(
  endpoint: {
    url: string;
    token: string;
    deviceId?: string;
    transportKey?: string;
    transport?: string;
  },
  sessionId: string | undefined,
  asid: string
): Promise<AgentSessionSnapshot | null> {
  if (usesOfflineDemo(endpoint))
    return asid === DEMO_COMPACTION_ASID
      ? demoCompactionSnapshot()
      : (demoStageSnapshot(asid) ??
          demoCompactionLogsSnapshot(asid) ??
          demoNotificationSnapshot(asid) ??
          demoNativePreviewSnapshot(asid));
  try {
    const base = endpoint.url.replace(/\/$/, '');
    const res = await gatewayEndpointFetch(
      endpoint as GatewayEndpoint,
      `${base}${sessionRoute(asid, '', sessionId, true)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${endpoint.token}` },
      }
    );
    if (!res.ok) return null;
    return parseAgentSessionSnapshot(envelopeData(await res.json()));
  } catch {
    return null;
  }
}

export async function getAgentSessionSnapshot(
  sessionId: string | undefined,
  asid: string,
  options?: { refresh?: boolean; capabilities?: readonly string[] }
): Promise<AgentSessionSnapshot> {
  if (usesOfflineDemo()) {
    const stage = demoStageSnapshot(asid);
    if (stage) return stage;
    if (asid === DEMO_COMPACTION_ASID) return demoCompactionSnapshot();
    const compactionLogs = demoCompactionLogsSnapshot(asid);
    if (compactionLogs) return compactionLogs;
    const notification = demoNotificationSnapshot(asid);
    if (notification) return notification;
    const preview = demoNativePreviewSnapshot(asid);
    if (preview) return preview;
    throw new Error('This agent session is not available in the offline demo');
  }
  const query = agentSnapshotRefreshQuery(options?.refresh === true, options?.capabilities);
  const res = await gatewayFetch(gatewayUrl(sessionRoute(asid, '', sessionId, true) + query), {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get agent session: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  // The snapshot is the first agent-session answer a workbench reads, so
  // what its envelope advertises decides how the subtree is fetched next.
  observeEnvelopeCapabilities(json);
  return parseAgentSessionSnapshot(envelopeData(json));
}

export async function deleteAgentSession(asid: string): Promise<void> {
  await writeJson(sessionRoute(asid), 'Failed to delete session', undefined, 'DELETE');
}

export async function renameAgentSession(asid: string, title: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/rename'), 'Failed to rename session', { title });
}

/** Whole-session fork; item boundaries require a separate advertised contract. */
export async function forkAgentSession(asid: string, agentId?: string): Promise<AgentSessionInfo> {
  const path = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(asid)}/fork`
    : sessionRoute(asid, '/fork');
  const data = await writeJson(path, 'Failed to fork session', {});
  const info = parseAgentSessionInfo(data);
  if (!info) throw new Error('Failed to fork session: unreadable response');
  return info;
}

/**
 * Marks the session read, and answers with the moment it was marked at.
 *
 * Unread is `time_idle > time_viewed`, and both numbers are the gateway's. The
 * answer is handed back so the caller can put `time_viewed` where it belongs
 * without waiting for `agent.session.updated` to come round: a mark that takes
 * a second to show is a dot that blinks on after a turn the reader watched end.
 * `undefined` when the gateway answered without one -- and then the event is
 * the only thing that clears it, which is the behaviour this replaces.
 */
export async function markAgentSessionViewed(
  asid: string,
  idle?: number
): Promise<number | undefined> {
  const data = await writeJson(
    sessionRoute(asid, '/view'),
    'Failed to mark session viewed',
    idle === undefined ? {} : { idle }
  );
  const rec = asRecord(data);
  return rec ? asFiniteNumber(rec.viewed) : undefined;
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

/**
 * Run a catalog skill on this session.
 *
 * `POST …/skill {skill, resume?}` -- not the skill's id typed into the prompt,
 * which is what a picked skill used to become: the composer listed every
 * catalog skill as `/<id>` and then sent the line as prose, so the model read
 * "/commit-message" as text and answered it.
 *
 * `resume` asks the engine to continue the run the skill was part of rather
 * than starting a turn of its own; it is omitted unless the caller says so.
 */
/**
 * The next older history page. An empty `items` list means there is no
 * further page.
 *
 * `409 history_cursor_lost` is the adapter saying it no longer holds the
 * cursor this paging was reading from -- it restarted, or evicted it -- which
 * is not the end of the history. `cursorLost` tells the caller to re-read the
 * snapshot, which gives the adapter a cursor again, and page on from there.
 */
export async function loadEarlierAgentTimeline(
  sessionId: string | undefined,
  asid: string
): Promise<{ items: TimelineItem[]; exhausted: boolean; cursorLost?: boolean }> {
  if (usesOfflineDemo()) throw new Error('Agent writes are not available in the offline demo');

  const res = await gatewayFetch(
    gatewayUrl(sessionRoute(asid, '/timeline/earlier', sessionId, false)),
    { method: 'POST', headers: jsonHeaders(), body: '{}' }
  );
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 && readApiError(text).code === 'history_cursor_lost') {
      return { items: [], exhausted: false, cursorLost: true };
    }
    throw new Error(`Failed to load earlier messages: ${res.status} ${text}`);
  }
  return parseEarlierTimelinePage(envelopeData(await res.json()));
}

export async function invokeAgentSkill(
  sessionId: string | undefined,
  asid: string,
  params: { skill: string; resume?: boolean }
): Promise<void> {
  const body: Record<string, unknown> = { skill: params.skill };
  if (params.resume !== undefined) body.resume = params.resume;
  // A v2-parity route, so it is on the global path only -- `sessionId` is
  // taken for symmetry with the other calls and never spelled into the URL.
  await writeJson(sessionRoute(asid, '/skill', sessionId, false), 'Failed to run skill', body);
}

/**
 * Runs a skill in an agent's terminal pane, by name, the way `invokeAgentSkill`
 * does for a session: the Gateway checks the skill is one that pane offers and
 * decides how its agent runs it. `args` is what was typed after the skill.
 */
export async function invokePaneSkill(
  sessionId: string,
  target: string,
  params: { skill: string; args?: string }
): Promise<void> {
  const body: Record<string, unknown> = { skill: params.skill };
  if (params.args) body.args = params.args;
  await writeJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(target)}/skill`,
    'Failed to run skill',
    body
  );
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

/** Mode ids are lowercase; OpenCode rejects a display name such as `Build`. */
export async function switchAgentMode(asid: string, mode: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/mode'), 'Failed to switch mode', {
    mode: mode.toLowerCase(),
  });
}

/**
 * Stage a rollback, and answer with what committing it would do.
 *
 * Two steps rather than one, because a rollback that cannot be previewed cannot
 * be confirmed: `files: true` asks OpenCode to work out the file changes the
 * rollback would undo, which is what the plate above the composer draws. The
 * one-shot `POST …/revert` below still exists and still stages-and-commits in
 * one call; nothing new should use it.
 */
export async function stageAgentRevert(
  asid: string,
  messageId: string,
  files = true
): Promise<AgentSessionRevert | null> {
  const data = await writeJson(sessionRoute(asid, '/revert/stage'), 'Failed to stage revert', {
    message_id: messageId,
    files,
  });
  return parseAgentSessionRevert(data);
}

/** Apply what is staged. With nothing staged this is a no-op, not an error. */
export async function commitAgentRevert(asid: string): Promise<void> {
  await writeJson(sessionRoute(asid, '/revert/commit'), 'Failed to apply revert');
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
  if (usesOfflineDemo()) {
    if (isDemoCompactionLogAsid(asid)) {
      advanceDemoCompactionLogs(asid);
      return;
    }
    if (asid !== DEMO_COMPACTION_ASID) throw new Error('Not the offline compaction session');
    advanceDemoCompaction();
    return;
  }
  await writeJson(sessionRoute(asid, '/compact'), 'Failed to compact session', { delivery });
}

/** Everything still in the model's context, i.e. after the last compaction. */
export async function getAgentContext(asid: string): Promise<AgentContextUsage> {
  if (usesOfflineDemo() && isDemoCompactionLogAsid(asid))
    return {
      tokens: demoCompactionLogsSnapshot(asid)?.info?.tokens ?? null,
      limit: { context: 32768 },
    };
  if (usesOfflineDemo() && asid === DEMO_COMPACTION_ASID)
    return { tokens: demoCompactionSnapshot().info?.tokens ?? null, limit: { context: 32768 } };
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

/**
 * The rules an "Always allow" left behind, for this session's project.
 *
 * `allow_always` is the one permission answer with a consequence that outlives
 * the prompt, and there was nowhere in the app to see what had been agreed to,
 * let alone take it back.
 */
export async function listSavedPermissions(asid: string): Promise<SavedPermission[]> {
  if (!asid) return [];
  return readJson(sessionRoute(asid, '/permissions/saved'), parseSavedPermissions, []);
}

/** Take one back: the agent asks again next time. */
export async function revokeSavedPermission(asid: string, id: string): Promise<void> {
  await writeJson(
    sessionRoute(asid, `/permissions/saved/${encodeURIComponent(id)}`),
    'Failed to revoke the rule',
    undefined,
    'DELETE'
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
): Promise<AgentVcsDiff> {
  if (!asid) return { files: [] };
  const read = await readScoped<AgentVcsDiff>(
    `${sessionRoute(asid, '/vcs/diff', sessionId, true)}?mode=${mode}`,
    parseAgentVcsDiff,
    { files: [] }
  );
  return read.missing
    ? { files: [], reason: 'workspace_missing', missing: read.missing }
    : read.value;
}

/**
 * The changed files, without their patches (`agent_vcs_files`).
 *
 * `null` means this route gave no usable answer -- a gateway that advertised
 * the capability and then refused, or answered something else -- and is the
 * caller's cue to fall back to `getAgentVcsDiff`. A missing folder is an
 * answer, not a failure, and comes back as one.
 */
export async function getAgentVcsFiles(
  sessionId: string | undefined,
  asid: string,
  mode: VcsFilesMode = 'working'
): Promise<AgentVcsFiles | null> {
  if (!asid) return null;
  const read = await readScoped<AgentVcsFiles | null>(
    `${sessionRoute(asid, '/vcs/files', sessionId)}?mode=${mode}`,
    parseAgentVcsFiles,
    null
  );
  if (read.missing) {
    return {
      files: [],
      mode,
      truncated: false,
      reason: 'workspace_missing',
      missing: read.missing,
    };
  }
  return read.value;
}

/**
 * One file's patch at `context` lines of context (`agent_vcs_files`).
 *
 * Throws when there is no patch to show, so the file row can say so; the
 * sheet asks for this only when the reader opens the file.
 */
export async function getAgentVcsFile(
  sessionId: string | undefined,
  asid: string,
  options: { mode: VcsFilesMode; path: string; context: number }
): Promise<AgentVcsFilePatch> {
  const params = new URLSearchParams({
    mode: options.mode,
    path: options.path,
    context: String(options.context),
  });
  const read = await readScoped<AgentVcsFilePatch | null>(
    `${sessionRoute(asid, '/vcs/file', sessionId)}?${params.toString()}`,
    parseAgentVcsFilePatch,
    null
  );
  if (!read.value) throw new Error(`Failed to load the patch for ${options.path}`);
  return read.value;
}

/**
 * Throw away one file's uncommitted changes (`agent_vcs_files`): a tracked
 * file is restored, an untracked one deleted. Irreversible; the sheet asks
 * first.
 */
export async function discardAgentVcsFile(
  sessionId: string | undefined,
  asid: string,
  path: string
): Promise<AgentVcsDiscard> {
  const data = await writeJson(
    sessionRoute(asid, '/vcs/discard', sessionId),
    'Failed to discard changes',
    { path }
  );
  return parseAgentVcsDiscard(data) ?? { path, action: 'restored' };
}

/**
 * The catalog: models, agents, skills, commands and the host's own defaults.
 *
 * `directory` is what makes a *project's* agents, commands and skills appear.
 * OpenCode scopes all three per project, so the answer to an unscoped read is
 * the global set only -- a user's own agent under the workspace's
 * `.opencode/agent` is simply not in it. The route takes `?directory=` for
 * exactly this, and the directory is part of the read's identity: it goes into
 * the cache key, so the ETag and the in-flight dedupe are per workspace and
 * two workspaces on one host can never be handed each other's catalog.
 *
 * A caller with no directory keeps the behaviour and the cache entry it had.
 */
/** The last catalog this device stored for the scope, including a stale one. */
export function peekAgentCatalog(
  sessionId?: string,
  options?: { directory?: string; agentId?: string }
): AgentCatalog | null {
  const directory = normalizeCatalogDirectory(options?.directory);
  const cacheKey = buildAgentCacheKey(
    'catalog',
    undefined,
    sessionId,
    agentCatalogCacheVariant(directory, options?.agentId)
  );
  return getCachedAgentCatalogSync(cacheKey);
}

/**
 * A stored record's address and credentials for the catalog loaders, which
 * otherwise read through the shared client. Everything the record carries is
 * taken, not only its URL and token: a record with a transport key must be
 * sealed with it, whichever computer the client is pointed at.
 */
export type CatalogEndpoint = Partial<Omit<GatewayEndpoint, 'token'>> & {
  token?: string | null;
};

/** The request a stored record is read through; the shared client when none is named. */
function catalogFetch(endpoint: CatalogEndpoint | undefined, url: string, init: RequestInit) {
  if (!endpoint?.url) return gatewayFetch(url, init);
  return gatewayEndpointFetch(
    {
      url: endpoint.url,
      token: endpoint.token ?? '',
      ...(endpoint.deviceId ? { deviceId: endpoint.deviceId } : {}),
      ...(endpoint.transportKey ? { transportKey: endpoint.transportKey } : {}),
      ...(endpoint.transport ? { transport: endpoint.transport } : {}),
    },
    url,
    init
  );
}

export async function getAgentCatalog(
  sessionId?: string,
  endpoint?: CatalogEndpoint,
  options?: { directory?: string; forceRefresh?: boolean; requireFresh?: boolean; agentId?: string }
): Promise<AgentCatalog> {
  if (usesOfflineDemo(endpoint)) return EMPTY_CATALOG;
  const directory = normalizeCatalogDirectory(options?.directory);
  const cacheKey = buildAgentCacheKey(
    'catalog',
    endpoint?.url,
    sessionId,
    agentCatalogCacheVariant(directory, options?.agentId)
  );
  const cached = getCachedEntry<AgentCatalog>(cacheKey);
  const isFresh = cached && Date.now() - cached.timestamp < CATALOG_TTL_MS;

  if (isFresh && !options?.forceRefresh && !options?.requireFresh) {
    return cached.data;
  }

  return dedupeInFlight(options?.requireFresh ? `${cacheKey}:fresh` : cacheKey, async () => {
    try {
      const base = endpoint?.url ? endpoint.url.replace(/\/$/, '') : null;
      if (!base && !isGatewayConfigured()) {
        if (options?.requireFresh) throw new Error('Gateway is not connected');
        return cached?.data ?? EMPTY_CATALOG;
      }
      const path = agentCatalogPath(sessionId, directory, options?.agentId);
      const url = base ? `${base}${path}` : gatewayUrl(path);
      const headers: Record<string, string> = endpoint?.url
        ? {
            ...activeLocaleHeaders(),
            ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
          }
        : gatewayAuthHeaders();

      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      const res = await catalogFetch(endpoint, url, { method: 'GET', headers });

      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }

      if (!res.ok) {
        if (options?.requireFresh) throw new Error(`Catalog request failed (${res.status})`);
        return cached?.data ?? EMPTY_CATALOG;
      }

      const etag = res.headers.get('etag') ?? undefined;
      const catalog = parseAgentCatalog(envelopeData(await res.json()));
      // A workspace the engine has not loaded yet answers `200` with an empty
      // catalog and an ETag of its own, and caching that hides every model on
      // the host behind an empty picker until the TTL runs out. Answered, not
      // remembered -- and answered with whatever this workspace last really
      // had, because a catalog that went empty for a moment is not a host that
      // lost its models. See `isEmptyAgentCatalog`.
      if (isEmptyAgentCatalog(catalog))
        return options?.requireFresh ? catalog : (cached?.data ?? catalog);
      setCachedEntry(cacheKey, catalog, etag);
      return catalog;
    } catch (err) {
      if (options?.requireFresh) throw err;
      console.warn('Failed to get agent catalog:', err);
      return cached?.data ?? EMPTY_CATALOG;
    }
  });
}

export async function getAgentProjects(
  sessionId?: string,
  endpoint?: CatalogEndpoint,
  options?: { forceRefresh?: boolean; agentId?: string }
): Promise<AgentProject[]> {
  if (usesOfflineDemo(endpoint)) return [];
  const cacheKey = buildAgentCacheKey(
    'projects',
    endpoint?.url,
    sessionId,
    scopedAgentCacheVariant(null, options?.agentId)
  );
  const cached = getCachedEntry<AgentProject[]>(cacheKey);
  const isFresh = cached && Date.now() - cached.timestamp < PROJECTS_TTL_MS;

  if (isFresh && !options?.forceRefresh) {
    return cached.data;
  }

  return dedupeInFlight(cacheKey, async () => {
    try {
      const base = endpoint?.url ? endpoint.url.replace(/\/$/, '') : null;
      if (!base && !isGatewayConfigured()) return cached?.data ?? [];
      const path = withScopedAgentId(
        sessionId
          ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-projects`
          : '/api/agent-projects',
        options?.agentId
      );
      const url = base ? `${base}${path}` : gatewayUrl(path);
      const headers: Record<string, string> = endpoint?.url
        ? {
            ...activeLocaleHeaders(),
            ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
          }
        : gatewayAuthHeaders();

      if (cached?.etag) {
        headers['If-None-Match'] = cached.etag;
      }

      const res = await catalogFetch(endpoint, url, { method: 'GET', headers });

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
      // The same rule the catalog keeps, for the same reason: an engine that
      // has just started answers `200` with an empty list and an ETag, and
      // caching that empties the workspace switcher for the whole TTL with no
      // request going out to correct it. Answered, never remembered.
      if (projects.length === 0) return cached?.data ?? projects;
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
): Promise<DirectoryListing> {
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  if (query) params.set('query', query);
  const q = params.toString() ? `?${params.toString()}` : '';
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-directories${q}`
    : `/api/agent-directories${q}`;
  return readJson(path, parseDirectoryListing, EMPTY_DIRECTORY_LISTING);
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
  try {
    await writeJson(
      `/api/agent-shells/${encodeURIComponent(shellId)}`,
      'Failed to stop shell',
      undefined,
      'DELETE'
    );
  } catch (error) {
    // The process can finish between inventory and Stop. That is already the
    // requested end state; let the tray refresh instead of showing a failure.
    if (!isShellNotFoundError(error)) throw error;
  }
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

/**
 * A project's checkouts: its own root, and every worktree OpenCode manages.
 *
 * `directory` is the **project** on all four routes here and never a
 * worktree's own -- the one thing easiest to get wrong about them, because the
 * remove route takes both and they are not the same argument.
 */
export async function listAgentWorktrees(directory?: string): Promise<AgentWorktreeListing> {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : '';
  const read = await readScoped(
    `/api/agent-worktrees${q}`,
    parseWorktreeList,
    [] as WorktreeDirectory[]
  );
  return read.missing ? { entries: [], missing: read.missing } : { entries: read.value };
}

/**
 * What a create may say, and every field of it optional.
 *
 * `{}` is a valid create: OpenCode names the worktree itself. A field the
 * caller did not set is left out of the body entirely rather than sent as
 * `null`, because `Worktree.CreateInput` declares `additionalProperties:
 * false` and refuses an explicit one.
 */
export interface CreateAgentWorktreeInput {
  /** The project to create it in. */
  directory?: string;
  /** What the worktree's own directory is called. */
  name?: string;
  /**
   * An **existing** ref to branch from -- not a name to create.
   *
   * A ref the repository does not have is `fatal: invalid reference: …` as a
   * `502`, so the field is offered as "Branch from" and validated no further
   * here: which refs exist is the repository's answer, not the app's.
   */
  branch?: string;
  /** A directory to branch from, rather than a ref. */
  from?: string;
  strategy?: string;
}

/**
 * Create one, and answer with the directory it landed in.
 *
 * Synchronous: the route answers when the worktree exists, so there is no
 * `creating` to wait for on the stream and the caller's own request is the
 * span the spinner covers.
 */
export async function createAgentWorktree(
  input: CreateAgentWorktreeInput
): Promise<string | undefined> {
  const body: Record<string, string> = {};
  for (const key of ['directory', 'name', 'branch', 'from', 'strategy'] as const) {
    const value = input[key]?.trim();
    if (value) body[key] = value;
  }
  return parseCreatedWorktree(
    await writeJson('/api/agent-worktrees', 'Failed to create worktree', body)
  );
}

/**
 * Remove one. **Two directories, and they are not the same one.**
 *
 * `worktree` is the checkout going away; `directory` is the project it belongs
 * to. `force` is always sent -- OpenCode's own input makes it required -- and
 * a refusal for want of it carries `forceRequired`, which
 * `isWorktreeForceRequired` is what turns into the second ask.
 */
export async function removeAgentWorktree(
  worktree: string,
  options?: { directory?: string; force?: boolean }
): Promise<void> {
  await writeJson(
    '/api/agent-worktrees',
    'Failed to remove worktree',
    {
      ...(options?.directory ? { directory: options.directory } : {}),
      worktree,
      force: options?.force === true,
    },
    'DELETE'
  );
}

/** Rediscover worktrees on disk, for when something changed outside OpenCode. */
export async function refreshAgentWorktrees(directory?: string): Promise<void> {
  await writeJson(
    '/api/agent-worktrees/refresh',
    'Failed to refresh worktrees',
    directory ? { directory } : {}
  );
}

/**
 * Point a session at another directory, and answer with the session afterwards.
 *
 * The reply is read back rather than assembled from the request, because a
 * move can change more than the directory: 2.0.1 accepts any directory that
 * exists and the session joins that directory's project, `project_id` and all.
 * There is no scope rule to enforce here -- keeping a session inside its own
 * project is done by offering only that project's worktrees as targets.
 *
 * `agent.session.updated` follows on the stream with the same new `directory`,
 * so the header and the strip do not wait on this answer.
 */
export async function moveAgentSession(
  asid: string,
  directory: string
): Promise<AgentSessionInfo | null> {
  return parseAgentSessionInfo(
    await writeJson(sessionRoute(asid, '/move'), 'Failed to move session', { directory })
  );
}

// ---------------------------------------------------------------------------
// Engine status
// ---------------------------------------------------------------------------

/** The one agent route that answers 200 with no engine attached. */
export function getAgentStatus(endpoint?: undefined, agentId?: string): Promise<AgentStatusInfo>;
/** An older Gateway has no status route, which is unknown rather than not installed. */
export function getAgentStatus(
  endpoint: GatewayEndpoint,
  agentId?: string
): Promise<AgentStatusInfo | null>;
export async function getAgentStatus(
  endpoint?: GatewayEndpoint,
  /** Which agentId to ask after; the primary when omitted or the default. */
  agentId?: string
): Promise<AgentStatusInfo | null> {
  const fallback: AgentStatusInfo = {
    available: false,
    origin: 'none',
    stream_connected: false,
    autostart: true,
  };
  if (usesOfflineDemo(endpoint)) return fallback;
  const path = withAgentIdQuery('/api/agent-status', agentId);
  if (!endpoint) return readJson(path, parseAgentStatusInfo, fallback);

  const base = endpoint.url.replace(/\/$/, '');
  const response = await gatewayEndpointFetch(endpoint, `${base}${path}`, {
    method: 'GET',
    headers: endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {},
  });
  if (response.status === 404 || response.status === 501) return null;
  if (!response.ok) throw new Error(`Engine status request failed (${response.status})`);
  return parseAgentStatusInfo(envelopeData(await response.json()));
}

// ---------------------------------------------------------------------------
// Agents discovery
// ---------------------------------------------------------------------------

/**
 * `GET /api/discovery`: which agents this gateway drives and what each can
 * do, with the terminal and SSH planes beside them.
 *
 * Asked only of a gateway whose `/health` capability list says the answer has
 * an agent plane (`hasMultiAgent`); any other gateway is the single
 * OpenCode engine it always was, and `null` here is what tells every caller
 * to keep that path. The route answers outside the content envelope, which
 * `parseGatewayDiscovery` allows for. A refusal, a missing route and a body
 * that is not a discovery document all answer `null` too: discovery is an
 * improvement on the single-engine path, never a gate in front of it.
 */
export async function getAgentsDiscovery(options: {
  /** The server to ask, or the selected gateway when omitted. */
  endpoint?: GatewayEndpoint;
  /** The server's latest `/health` capability list, which decides whether to ask at all. */
  capabilities: readonly string[] | undefined | null;
  signal?: AbortSignal;
  /**
   * Whose answer this is, for the gateway `generation` it carries. Defaults to
   * the selected gateway when no `endpoint` is given.
   */
  serverId?: string;
}): Promise<GatewayDiscovery | null> {
  if (usesOfflineDemo(options.endpoint)) return null;
  if (!hasMultiAgent(options.capabilities)) return null;
  const serverId = options.serverId ?? (options.endpoint ? null : configuredGatewayServerId());
  try {
    let response: Response;
    if (options.endpoint) {
      const base = options.endpoint.url.replace(/\/$/, '');
      if (!base) return null;
      response = await gatewayEndpointFetch(options.endpoint, `${base}/api/discovery`, {
        method: 'GET',
        headers: options.endpoint.token
          ? { Authorization: `Bearer ${options.endpoint.token}` }
          : {},
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } else {
      if (!isGatewayConfigured()) return null;
      response = await gatewayFetch(gatewayUrl('/api/discovery'), {
        method: 'GET',
        headers: gatewayAuthHeaders(),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    }
    if (!response.ok) return null;
    const body: unknown = await response.json();
    noteGatewayGeneration(serverId, body);
    const discovery = parseGatewayDiscovery(body);
    return discovery.agents || discovery.terminal || discovery.ssh ? discovery : null;
  } catch {
    return null;
  }
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
  const empty: AgentTimelineDelta = { items: [], resync: false, latest_seq: afterSeq };
  if (usesOfflineDemo()) return empty;
  try {
    if (!isGatewayConfigured()) return empty;
    const res = await gatewayFetch(
      gatewayUrl(`${sessionRoute(asid, '/timeline', sessionId, true)}?after=${afterSeq}`),
      { method: 'GET', headers: gatewayAuthHeaders() }
    );
    // `410 resync_required`: the point asked for has fallen out of the ring
    // buffer, so there is no delta to be had and the snapshot is the only
    // honest answer. This has to be read off the status -- the generic read
    // helper turns every refusal into the empty delta, which would have been
    // indistinguishable from "nothing happened".
    if (res.status === 410) return { items: [], resync: true, latest_seq: afterSeq };
    if (!res.ok) return empty;
    const rec = asRecord(envelopeData(await res.json())) ?? {};
    return {
      items: sortTimeline(parseTimelineItems(rec.items)),
      ...(typeof rec.status === 'string' ? { status: parseRunStatus(rec.status) } : {}),
      resync: rec.resync === true,
      latest_seq: typeof rec.latest_seq === 'number' ? rec.latest_seq : afterSeq,
    };
  } catch {
    return empty;
  }
}

/**
 * The session's event stream, with its ending reported.
 *
 * `onClose` fires when the far end hangs up in good order -- a gateway
 * restart, a proxy's idle timeout, OpenCode being restarted underneath it. It
 * used to be silent: the read loop fell off the bottom of its `while`,
 * `connect()` resolved, and nothing told the caller. The reconnect backoff
 * never armed and the session sat there looking current while the engine moved
 * on without it, until the reader left the screen and came back.
 *
 * On an encrypted pairing this goes through the sealed event-stream path, the
 * same one `use-pane-events` opens `/api/sessions/{id}/events` on. It used not
 * to: it opened the stream with a bare `Authorization` header, which on a
 * gateway configured `transport_encryption: required` put the device token and
 * every agent event -- prompts, tool calls, file contents, diffs -- on the wire
 * in the clear, on the one route that carries the most of them. The token
 * travels inside the request envelope now and every event arrives as a sealed
 * record. A cleartext pairing sends exactly the request it always did.
 */
export function openAgentSessionStream(options: {
  asid: string;
  sessionId?: string;
  /** Already parsed and validated; an unrecognised frame never arrives here. */
  onEvent: (event: AgentDomainEvent) => void;
  /** The transport failed. */
  onError?: (err: unknown) => void;
  /** The far end closed it in good order. Reconnect, the same as an error. */
  onClose?: () => void;
  onConnected?: () => void;
}): () => void {
  if (usesOfflineDemo()) {
    if (isDemoCompactionLogAsid(options.asid))
      return subscribeDemoCompactionLogs(options.asid, options.onEvent);
    if (isDemoNoticeAsid(options.asid))
      return subscribeDemoNotification(options.asid, options.onEvent);
    // No SSE, socket retry or timer. The real Workbench batches these typed
    // events through its normal handler; only the existing Compact action advances them.
    return options.asid === DEMO_COMPACTION_ASID
      ? subscribeDemoCompaction(options.onEvent)
      : () => {};
  }
  let cancelled = false;
  const controller = new AbortController();
  // The same watchdog the pane stream keeps: a half-open connection delivers
  // nothing and never errors, and the session sat on it looking current. Past
  // the idle limit it is aborted, which reaches `onError` and the caller's
  // reconnect like any other failure. The gateway's keep-alives count as
  // heard, so a quiet session is not mistaken for a dead one.
  let lastHeardAt = Date.now();
  const watchdog = setInterval(() => {
    if (!cancelled && streamIsStalled(lastHeardAt, Date.now())) controller.abort();
  }, STREAM_WATCHDOG_TICK_MS);

  const connect = async () => {
    try {
      if (!isGatewayConfigured()) {
        options.onError?.(new Error('Gateway not configured'));
        return;
      }
      const url = gatewayUrl(sessionRoute(options.asid, '/stream', options.sessionId, true));
      // Sealed fresh for this connection, and for every reconnect after it: the
      // gateway replay-caches the request envelope's nonce and binds the
      // per-stream key to it, so a recording of an earlier stream can never
      // answer a later one. Null on a cleartext pairing, which is every pairing
      // whose gateway does not encrypt the transport.
      const sealed = await encryptedEventStreamRequest(url);
      const ending = await connectAgentStream({
        url,
        seal: sealed ? { ...sealed, crypto: streamRecordCrypto } : null,
        plainHeaders: gatewayAuthHeaders(),
        outerHeaders: activeLocaleHeaders(),
        // Structurally what the stream needs of a `Response`; the nominal type
        // is nitro-fetch's, and it is not exported in a form this can name.
        fetch: (target, init) =>
          nitroFetch(target, init) as unknown as Promise<AgentStreamResponse>,
        newDecoder: () => new TextDecoder(),
        signal: controller.signal,
        abort: () => controller.abort(),
        isCancelled: () => cancelled,
        onEvent: options.onEvent,
        onHeard: () => {
          lastHeardAt = Date.now();
        },
        ...(options.onConnected
          ? {
              onConnected: () => {
                lastHeardAt = Date.now();
                options.onConnected?.();
              },
            }
          : {}),
      });

      // The one line this whole split exists for.
      if (ending === 'closed' && !cancelled) options.onClose?.();
    } catch (err) {
      if (!cancelled) {
        options.onError?.(err);
      }
    } finally {
      clearInterval(watchdog);
    }
  };

  void connect().catch((err) => {
    if (!cancelled) options.onError?.(err);
  });

  return () => {
    cancelled = true;
    clearInterval(watchdog);
    controller.abort();
  };
}
