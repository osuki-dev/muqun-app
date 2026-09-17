import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { TextDecoder } from 'react-native-nitro-text-decoder';
import { gatewayAuthHeaders, gatewayFetch, gatewayUrl, isGatewayConfigured } from './gateway-client';
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

export { getCachedAgentCatalogSync, getCachedAgentProjectsSync, buildAgentCacheKey };

export type AgentSessionStatus = 'idle' | 'running' | 'paused' | 'error' | 'terminated';

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

export interface ModelRef {
  provider_id: string;
  model_id: string;
  variant?: string;
}

export function formatModelName(model?: ModelRef): string {
  if (!model?.model_id) return 'Model';
  const modelId = model.model_id;
  const known: Record<string, string> = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
    'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
    'gpt-5.6-sol': 'GPT-5.6 Sol',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-6-astra': 'GPT-6 Astra',
    'gpt-6-astra-fast': 'GPT-6 Astra Fast',
    'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
    'ling-3.0-flash-fin-free': 'Ling 3.0 Flash',
  };
  const baseName =
    known[modelId] ||
    modelId
      .split(/[-_]/)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');

  if (model.variant) {
    const varLabel =
      model.variant === 'xhigh'
        ? 'Max'
        : model.variant.charAt(0).toUpperCase() + model.variant.slice(1);
    return `${baseName} • ${varLabel}`;
  }
  return baseName;
}

export interface TokensUsage {
  input: number;
  output: number;
  reasoning?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface AgentSessionInfo {
  asid: string;
  backend_session_id: string;
  title: string;
  agent?: string;
  model?: ModelRef;
  status: AgentSessionStatus;
  directory?: string;
  cost?: number;
  tokens?: TokensUsage;
  limit?: { context?: number; output?: number; input?: number };
  parent_id?: string;
  project_id?: string;
  updated_ms: number;
}

export type ToolCallStatus = 'running' | 'completed' | 'failed';

export interface TodoItem {
  text: string;
  done: boolean;
}

export type PermissionDecision = 'allow' | 'allow_always' | 'deny';

export interface PermissionOption {
  index: number;
  label: string;
  decision: PermissionDecision;
}

export interface PermissionRequest {
  id: string;
  asid: string;
  action: string;
  resources: string[];
  prompt: string;
  tool?: string;
  message?: string;
  options: PermissionOption[];
}

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

export type FormField =
  | {
      type: 'string';
      key: string;
      title: string;
      description?: string;
      required?: boolean;
      placeholder?: string;
      default?: string;
      options?: FormOption[];
    }
  | {
      type: 'number';
      key: string;
      title: string;
      description?: string;
      required?: boolean;
      min?: number;
      max?: number;
      default?: number;
    }
  | {
      type: 'boolean';
      key: string;
      title: string;
      description?: string;
      required?: boolean;
      default?: boolean;
    }
  | {
      type: 'multiselect';
      key: string;
      title: string;
      description?: string;
      required?: boolean;
      default?: string[];
      options: FormOption[];
    }
  | {
      type: 'external';
      key: string;
      title: string;
      description?: string;
      url: string;
    };

export interface FormRequest {
  id: string;
  asid: string;
  title: string;
  fields: FormField[];
}

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; duration_ms?: number }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: unknown;
      output?: unknown;
      status: ToolCallStatus;
    }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'todo'; items: TodoItem[] }
  | { type: 'approval'; request: PermissionRequest }
  | { type: 'form'; request: FormRequest }
  | { type: 'status'; text: string };

export type TimelineRole = 'user' | 'assistant' | 'system';

export interface TimelineItem {
  id: string;
  message_id: string;
  role: TimelineRole;
  part: AgentPart;
  seq: number;
  updated_ms: number;
  attachments?: string[];
  queued?: boolean;
}

export interface AgentSessionSnapshot {
  info: AgentSessionInfo;
  timeline: TimelineItem[];
  permissions: PermissionRequest[];
  forms: FormRequest[];
  seq: number;
}

export interface ModelVariantInfo {
  id: string;
  reasoning_effort?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider_id: string;
  family?: string;
  limit?: { context?: number; output?: number; input?: number };
  variants?: ModelVariantInfo[];
  cost?: unknown;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  color?: string;
}

export interface McpServerInfo {
  name: string;
  status: string;
  error?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export interface AgentCatalog {
  models: ModelInfo[];
  agents: AgentInfo[];
  mcp: McpServerInfo[];
  skills?: SkillInfo[];
}

export interface FileDiffItem {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export function gatewaySupportsAgentSessions(capabilities: string[] | undefined | null): boolean {
  if (!Array.isArray(capabilities)) return false;
  return capabilities.includes('agent_sessions');
}

// ---------------------------------------------------------------------------
// Client API Methods (using gatewayFetch with NitroFetch & Request Budget)
// ---------------------------------------------------------------------------

export async function listAgentSessions(sessionId: string): Promise<AgentSessionInfo[]> {
  try {
    if (!isGatewayConfigured()) return [];
    const url = gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions`);
    const res = await gatewayFetch(url, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) {
      console.warn(`Failed to list agent sessions: ${res.status}`);
      return [];
    }
    const json = (await res.json()) as {
      data?: AgentSessionInfo[] | { sessions?: AgentSessionInfo[] };
      sessions?: AgentSessionInfo[];
    };
    if (Array.isArray(json.data)) return json.data;
    if (json.data && 'sessions' in json.data && Array.isArray(json.data.sessions)) {
      return json.data.sessions;
    }
    if (Array.isArray(json.sessions)) return json.sessions;
    return [];
  } catch (err) {
    console.warn('Failed to list agent sessions:', err);
    return [];
  }
}

export async function createAgentSession(
  sessionId: string,
  params: {
    title?: string;
    agent?: string;
    model?: ModelRef;
    directory?: string;
  }
): Promise<AgentSessionInfo> {
  const url = gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions`);
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`Failed to create agent session: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: AgentSessionInfo } | AgentSessionInfo;
  return ('data' in json && json.data ? json.data : json) as AgentSessionInfo;
}

export async function getAgentSessionSnapshot(
  sessionId: string,
  asid: string
): Promise<AgentSessionSnapshot> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}`
  );
  const res = await gatewayFetch(url, {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get agent session: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: AgentSessionSnapshot } | AgentSessionSnapshot;
  return ('data' in json && json.data ? json.data : json) as AgentSessionSnapshot;
}

export async function getAgentTimelineDelta(
  sessionId: string,
  asid: string,
  afterSeq: number
): Promise<{
  items?: TimelineItem[];
  status?: AgentSessionStatus;
  resync?: boolean;
  latest_seq: number;
}> {
  try {
    if (!isGatewayConfigured()) return { latest_seq: afterSeq };
    const url = gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/timeline?after=${afterSeq}`
    );
    const res = await gatewayFetch(url, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) {
      return { latest_seq: afterSeq };
    }
    const json = (await res.json()) as
      | {
          data?: {
            items?: TimelineItem[];
            status?: AgentSessionStatus;
            resync?: boolean;
            latest_seq: number;
          };
        }
      | { items?: TimelineItem[]; status?: AgentSessionStatus; resync?: boolean; latest_seq: number };
    const payload = 'data' in json && json.data ? json.data : json;
    return payload as {
      items?: TimelineItem[];
      status?: AgentSessionStatus;
      resync?: boolean;
      latest_seq: number;
    };
  } catch {
    return { latest_seq: afterSeq };
  }
}

export async function sendAgentPrompt(
  sessionId: string,
  asid: string,
  params: {
    text: string;
    model?: ModelRef;
    attachments?: string[];
    delivery?: 'steer' | 'queue';
  }
): Promise<void> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/prompt`
  );
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`Failed to send prompt: ${res.status} ${await res.text()}`);
  }
}

export async function revertAgentSession(
  sessionId: string | undefined,
  asid: string,
  messageId: string
): Promise<void> {
  const path = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/revert`
    : `/api/agent-sessions/${encodeURIComponent(asid)}/revert`;
  const url = gatewayUrl(path);
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message_id: messageId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to revert session: ${res.status} ${await res.text()}`);
  }
}

export async function abortAgentSession(sessionId: string, asid: string): Promise<void> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/abort`
  );
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to abort session: ${res.status} ${await res.text()}`);
  }
}

export async function switchAgentModel(
  sessionId: string,
  asid: string,
  model: ModelRef
): Promise<void> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/model`
  );
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    throw new Error(`Failed to switch agent model: ${res.status} ${await res.text()}`);
  }
}

export async function replyAgentPermission(
  sessionId: string,
  asid: string,
  permissionId: string,
  decision: PermissionDecision
): Promise<void> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/permissions/${encodeURIComponent(permissionId)}/reply`
  );
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reply permission: ${res.status} ${await res.text()}`);
  }
}

export async function replyAgentForm(
  sessionId: string,
  asid: string,
  formId: string,
  answer: Record<string, unknown>
): Promise<void> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/forms/${encodeURIComponent(formId)}/reply`
  );
  const res = await gatewayFetch(url, {
    method: 'POST',
    headers: {
      ...gatewayAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) {
    throw new Error(`Failed to reply form: ${res.status} ${await res.text()}`);
  }
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
        return cached?.data ?? { agents: [], models: [], mcp: [] };
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

      const res = await gatewayFetch(url, {
        method: 'GET',
        headers,
      });

      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }

      if (!res.ok) {
        return cached?.data ?? { agents: [], models: [], mcp: [] };
      }

      const etag = res.headers.get('etag') ?? undefined;
      const json = (await res.json()) as { data?: AgentCatalog } | AgentCatalog;
      const catalog = ('data' in json && json.data ? json.data : json) as AgentCatalog;
      setCachedEntry(cacheKey, catalog, etag);
      return catalog;
    } catch (err) {
      console.warn('Failed to get agent catalog:', err);
      return cached?.data ?? { agents: [], models: [], mcp: [] };
    }
  });
}

export async function getAgentVcsDiff(sessionId: string, asid: string): Promise<FileDiffItem[]> {
  try {
    if (!isGatewayConfigured()) return [];
    const url = gatewayUrl(
      `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/vcs-diff`
    );
    const res = await gatewayFetch(url, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as {
      data?: FileDiffItem[] | { diff?: FileDiffItem[] };
      diff?: FileDiffItem[];
    };
    if (Array.isArray(json.data)) return json.data;
    if (json.data && 'diff' in json.data && Array.isArray(json.data.diff)) {
      return json.data.diff;
    }
    if (Array.isArray(json.diff)) return json.diff;
    return [];
  } catch (err) {
    console.warn('Failed to get VCS diff:', err);
    return [];
  }
}

export async function listAgentFiles(
  sessionId?: string,
  asid?: string,
  query?: string,
  limit = 20
): Promise<FileMentionHit[]> {
  const q = query ? `?query=${encodeURIComponent(query)}&limit=${limit}` : `?limit=${limit}`;
  const path =
    sessionId && asid
      ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/files${q}`
      : asid
        ? `/api/agent-sessions/${encodeURIComponent(asid)}/files${q}`
        : sessionId
          ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-files${q}`
          : `/api/agent-files${q}`;
  const url = gatewayUrl(path);
  try {
    const res = await gatewayFetch(url, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: FileMentionHit[] } | FileMentionHit[];
    return 'data' in json && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
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

      const res = await gatewayFetch(url, {
        method: 'GET',
        headers,
      });

      if (res.status === 304 && cached) {
        touchCacheEntryTimestamp(cacheKey);
        return cached.data;
      }

      if (!res.ok) {
        return cached?.data ?? [];
      }

      const etag = res.headers.get('etag') ?? undefined;
      const json = (await res.json()) as { data?: AgentProject[] };
      const projects = json.data ?? [];
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
  const url = gatewayUrl(path);
  try {
    const res = await gatewayFetch(url, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: DirectoryItem[] };
    return json.data ?? [];
  } catch {
    return [];
  }
}

export function openAgentSessionStream(options: {
  asid: string;
  sessionId?: string;
  onEvent: (event: string, data: unknown) => void;
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
      const path = options.sessionId
        ? `/api/sessions/${encodeURIComponent(options.sessionId)}/agent-sessions/${encodeURIComponent(options.asid)}/stream`
        : `/api/agent-sessions/${encodeURIComponent(options.asid)}/stream`;
      const url = gatewayUrl(path);
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
        if (value) {
          const text = decoder.decode(value, { stream: true });
          const events = parser.push(text);
          for (const ev of events) {
            try {
              const parsed = JSON.parse(ev.data);
              options.onEvent(ev.event, parsed);
            } catch {
              options.onEvent(ev.event, ev.data);
            }
          }
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

