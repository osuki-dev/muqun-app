import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import {
  gatewayAuthHeaders,
  gatewayFetch,
  gatewayUrl,
  isGatewayConfigured,
} from './gateway-client';
import { pumpAgentStream } from './agent-stream';
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
  agentCatalogCacheVariant,
  agentCatalogPath,
  normalizeCatalogDirectory,
} from './agent-catalog-scope';
import {
  asFiniteNumber,
  asRecord,
  EMPTY_CATALOG,
  parseAgentCatalog,
  parseAgentContextUsage,
  parseAgentEngineInfo,
  parseAgentSessionInfo,
  parseAgentSessionList,
  parseAgentSessionRevert,
  parseAgentSessionSnapshot,
  parseFileDiffItems,
  parseInboxItems,
  parseSavedPermissions,
  parseShellList,
  parseShellOutputPage,
  parseTimelineItems,
  parseRunStatus,
  parseCreatedWorktree,
  parseWorktreeList,
  sortTimeline,
  type AgentCatalog,
  type AgentContextUsage,
  type AgentDomainEvent,
  type AgentEngineInfo,
  type AgentRunStatus,
  type AgentSessionInfo,
  type AgentSessionRevert,
  type AgentSessionSnapshot,
  type FileDiffItem,
  type InboxItem,
  type ModelRef,
  type PermissionDecision,
  type SavedPermission,
  type ShellInfo,
  type ShellOutputPage,
  type TimelineItem,
  type VcsDiffMode,
  type WorktreeDirectory,
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
  const run = async (): Promise<T> => {
    try {
      if (!isGatewayConfigured()) return fallback;
      const res = await gatewayFetch(url, {
        method: 'GET',
        headers: init?.headers ?? gatewayAuthHeaders(),
        ...(init?.signal ? { signal: init.signal } : {}),
      });
      if (!res.ok) return fallback;
      return parse(envelopeData(await res.json()));
    } catch {
      return fallback;
    }
  };
  return init?.signal ? run() : dedupeInFlight(`GET ${url}`, run);
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
export async function listAgentSessions(
  sessionId?: string,
  query?: ListAgentSessionsQuery
): Promise<AgentSessionInfo[]> {
  const search = listQuery(query);
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions${search}`
    : `/api/agent-sessions${search}`;
  // The query is part of the key: a listing scoped to one workspace is not the
  // same resource as the unscoped one, and they must not share an ETag.
  const cacheKey = buildAgentCacheKey('sessions', null, sessionId, search || 'all');
  const cached = getCachedEntry<AgentSessionInfo[]>(cacheKey);

  return dedupeInFlight(`GET ${path}`, async () => {
    try {
      if (!isGatewayConfigured()) return cached?.data ?? [];
      const headers: Record<string, string> = gatewayAuthHeaders();
      if (cached?.etag) headers['If-None-Match'] = cached.etag;

      const res = await gatewayFetch(gatewayUrl(path), { method: 'GET', headers });
      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }
      if (!res.ok) return cached?.data ?? [];

      const etag = res.headers.get('etag') ?? undefined;
      const list = parseAgentSessionList(envelopeData(await res.json()));
      setCachedEntry(cacheKey, list, etag);
      return list;
    } catch {
      return cached?.data ?? [];
    }
  });
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
): Promise<FileDiffItem[]> {
  if (!asid) return [];
  return readJson(
    `${sessionRoute(asid, '/vcs/diff', sessionId, true)}?mode=${mode}`,
    parseFileDiffItems,
    []
  );
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
export async function getAgentCatalog(
  sessionId?: string,
  endpoint?: { url?: string; token?: string | null },
  options?: { directory?: string; forceRefresh?: boolean }
): Promise<AgentCatalog> {
  const directory = normalizeCatalogDirectory(options?.directory);
  const cacheKey = buildAgentCacheKey(
    'catalog',
    endpoint?.url,
    sessionId,
    agentCatalogCacheVariant(directory)
  );
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
      const path = agentCatalogPath(sessionId, directory);
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
// Worktrees
// ---------------------------------------------------------------------------

/**
 * A project's checkouts: its own root, and every worktree OpenCode manages.
 *
 * `directory` is the **project** on all four routes here and never a
 * worktree's own -- the one thing easiest to get wrong about them, because the
 * remove route takes both and they are not the same argument.
 */
export async function listAgentWorktrees(directory?: string): Promise<WorktreeDirectory[]> {
  const q = directory ? `?directory=${encodeURIComponent(directory)}` : '';
  return readJson(`/api/agent-worktrees${q}`, parseWorktreeList, []);
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
  const empty: AgentTimelineDelta = { items: [], resync: false, latest_seq: afterSeq };
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

      const ending = await pumpAgentStream({
        reader,
        decoder: new TextDecoder(),
        onEvent: options.onEvent,
        isCancelled: () => cancelled,
      });

      // The one line this whole split exists for.
      if (ending === 'closed' && !cancelled) options.onClose?.();
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
