import { gatewayAuthHeaders, gatewayFetch, gatewayUrl } from './gateway-client';
import type { FileMentionHit } from './file-mentions';

export type AgentSessionStatus = 'idle' | 'running' | 'paused' | 'error' | 'terminated';

export interface ModelRef {
  provider_id: string;
  model_id: string;
  variant?: string;
}

export interface TokensUsage {
  input: number;
  output: number;
  reasoning?: number;
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
  parent_id?: string;
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
}

export interface AgentSessionSnapshot {
  info: AgentSessionInfo;
  timeline: TimelineItem[];
  permissions: PermissionRequest[];
  forms: FormRequest[];
  seq: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider_id: string;
  family?: string;
  limit?: unknown;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
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
  const url = gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions`);
  const res = await gatewayFetch(url, {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to list agent sessions: ${res.status} ${await res.text()}`);
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
}

export async function createAgentSession(
  sessionId: string,
  params: {
    title?: string;
    agent?: string;
    model?: ModelRef;
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
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/timeline?after=${afterSeq}`
  );
  const res = await gatewayFetch(url, {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get agent timeline delta: ${res.status} ${await res.text()}`);
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
}

export async function sendAgentPrompt(
  sessionId: string,
  asid: string,
  params: {
    text: string;
    model?: ModelRef;
    attachments?: string[];
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

export async function getAgentCatalog(sessionId?: string): Promise<AgentCatalog> {
  const url = sessionId
    ? gatewayUrl(`/api/sessions/${encodeURIComponent(sessionId)}/agent-catalog`)
    : gatewayUrl('/api/agent-catalog');
  const res = await gatewayFetch(url, {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get agent catalog: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: AgentCatalog } | AgentCatalog;
  return ('data' in json && json.data ? json.data : json) as AgentCatalog;
}

export async function getAgentVcsDiff(sessionId: string, asid: string): Promise<FileDiffItem[]> {
  const url = gatewayUrl(
    `/api/sessions/${encodeURIComponent(sessionId)}/agent-sessions/${encodeURIComponent(asid)}/vcs-diff`
  );
  const res = await gatewayFetch(url, {
    method: 'GET',
    headers: gatewayAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to get VCS diff: ${res.status} ${await res.text()}`);
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
