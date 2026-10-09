import { asFiniteNumber, asRecord, asString } from './agent-protocol';

/** The gateway announces this when it keeps a task ledger. */
export const TASK_LEDGER_CAPABILITY = 'task_ledger';

/**
 * The gateway opens a ledger task from the device (`POST /api/tasks`) and
 * serves the task tree: `parent_task_id`, `children`, `origin`, `?root=`.
 */
export const TASK_LEDGER_CREATE_CAPABILITY = 'task_ledger_create';

export const TASK_STATES = [
  'queued',
  'dispatching',
  'working',
  'waiting',
  'idle_unconfirmed',
  'done',
  'failed',
  'cancelled',
] as const;
export type TaskState = (typeof TASK_STATES)[number];
export type TaskKind = 'delegation' | 'command';

export type TaskBinding =
  | { kind: 'none' }
  | { kind: 'agent_session'; agentId: string; asid: string }
  | { kind: 'pane'; sessionId: string; paneId: string; tabId?: string; shellPid?: number };

export type TaskOrigin = 'device' | 'agent' | 'mcp';

/** A task's direct children, counted by the gateway when it was read. */
export interface TaskChildren {
  total: number;
  /** Neither finished nor waiting. */
  active: number;
  waiting: number;
  failed: number;
}

export interface TaskView {
  taskId: string;
  state: TaskState;
  kind: TaskKind;
  goal: string;
  /** One line: the agent's last message, a command's tail, or why it failed. */
  summary?: string;
  exitCode?: number;
  binding: TaskBinding;
  updatedMs: number;
  /** The open task this one was started from (task tree gateways only). */
  parentTaskId?: string;
  origin?: TaskOrigin;
  /** The title the requester gave. */
  label?: string;
  /** The device that opened it, for `origin: device`. */
  requestedBy?: { id: string; name: string };
  children?: TaskChildren;
}

export interface TaskEvent {
  taskId: string;
  seq: number;
  atMs: number;
  from?: TaskState;
  to: TaskState;
  source: string;
  note?: string;
}

function parseState(value: unknown): TaskState | null {
  return typeof value === 'string' && (TASK_STATES as readonly string[]).includes(value)
    ? (value as TaskState)
    : null;
}

function parseBinding(value: unknown): TaskBinding {
  const rec = asRecord(value);
  if (!rec) return { kind: 'none' };
  if (rec.kind === 'agent_session') {
    const agentId = asString(rec.agent_id);
    const asid = asString(rec.asid);
    if (agentId && asid) return { kind: 'agent_session', agentId, asid };
  } else if (rec.kind === 'pane') {
    const sessionId = asString(rec.session_id);
    const paneId = asString(rec.pane_id);
    if (sessionId && paneId) {
      const tabId = asString(rec.tab_id);
      const shellPid = asFiniteNumber(rec.shell_pid);
      return {
        kind: 'pane',
        sessionId,
        paneId,
        ...(tabId ? { tabId } : {}),
        ...(shellPid !== undefined ? { shellPid } : {}),
      };
    }
  }
  return { kind: 'none' };
}

function parseOrigin(value: unknown): TaskOrigin | undefined {
  return value === 'device' || value === 'agent' || value === 'mcp' ? value : undefined;
}

function parseChildren(value: unknown): TaskChildren | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const count = (field: unknown) => Math.max(0, Math.floor(asFiniteNumber(field) ?? 0));
  return {
    total: count(rec.total),
    active: count(rec.active),
    waiting: count(rec.waiting),
    failed: count(rec.failed),
  };
}

function parseRequester(value: unknown): { id: string; name: string } | undefined {
  const rec = asRecord(value);
  const id = asString(rec?.id);
  if (!rec || !id) return undefined;
  return { id, name: asString(rec.name) ?? '' };
}

/** A task as the gateway spells it (snake_case); null for a state this build cannot name. */
export function parseTaskView(value: unknown): TaskView | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const taskId = asString(rec.task_id);
  const state = parseState(rec.state);
  if (!taskId || !state) return null;
  const summary = asString(rec.summary);
  const exitCode = asFiniteNumber(rec.exit_code);
  const parentTaskId = asString(rec.parent_task_id);
  const origin = parseOrigin(rec.origin);
  const label = asString(rec.label)?.trim();
  const requestedBy = parseRequester(rec.requested_by);
  const children = parseChildren(rec.children);
  return {
    taskId,
    state,
    kind: rec.kind === 'command' ? 'command' : 'delegation',
    goal: asString(rec.goal) ?? '',
    ...(summary ? { summary } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    binding: parseBinding(rec.binding),
    updatedMs: asFiniteNumber(rec.updated_ms) ?? 0,
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(origin ? { origin } : {}),
    ...(label ? { label } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    ...(children ? { children } : {}),
  };
}

export function parseTaskEvent(value: unknown): TaskEvent | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const taskId = asString(rec.task_id);
  const to = parseState(rec.to);
  const seq = asFiniteNumber(rec.seq);
  if (!taskId || !to || seq === undefined) return null;
  const from = parseState(rec.from);
  const note = asString(rec.note);
  return {
    taskId,
    seq,
    atMs: asFiniteNumber(rec.at_ms) ?? 0,
    ...(from ? { from } : {}),
    to,
    source: asString(rec.source) ?? '',
    ...(note ? { note } : {}),
  };
}

export function isTerminalTaskState(state: TaskState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled';
}

export function hasTaskLedger(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(TASK_LEDGER_CAPABILITY) === true;
}

export function hasTaskLedgerCreate(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(TASK_LEDGER_CREATE_CAPABILITY) === true;
}

/** What `POST /api/tasks` takes. `model` is a catalog id or `provider_id/model_id`. */
export interface LedgerTaskRequest {
  goal: string;
  agentId?: string;
  cwd?: string;
  mode?: string;
  model?: string;
  label?: string;
}

export function ledgerTaskBody(request: LedgerTaskRequest): Record<string, string> {
  return {
    goal: request.goal,
    ...(request.agentId ? { agent_id: request.agentId } : {}),
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.mode ? { mode: request.mode } : {}),
    ...(request.model ? { model: request.model } : {}),
    ...(request.label?.trim() ? { label: request.label.trim() } : {}),
  };
}

/** The answer to `POST /api/tasks`: the task, flattened, plus the session it opened. */
export function parseCreatedLedgerTask(value: unknown): { task: TaskView; asid: string } | null {
  const task = parseTaskView(value);
  if (!task) return null;
  const asid =
    asString(asRecord(value)?.asid) ??
    (task.binding.kind === 'agent_session' ? task.binding.asid : undefined);
  return asid ? { task, asid } : null;
}

// The fetchers load the transport lazily: it pulls in React Native, and the
// parsers above must stay importable from plain unit tests.

export function parseTaskList(value: unknown): TaskView[] | null {
  const list = asRecord(value)?.tasks;
  if (!Array.isArray(list)) return null;
  const out: TaskView[] = [];
  for (const entry of list) {
    const task = parseTaskView(entry);
    if (task) out.push(task);
  }
  return out;
}

function parseTaskDetail(value: unknown): { task: TaskView; events: TaskEvent[] } | null {
  const rec = asRecord(value);
  const task = parseTaskView(rec?.task);
  if (!rec || !task) return null;
  const events: TaskEvent[] = [];
  if (Array.isArray(rec.events)) {
    for (const entry of rec.events) {
      const event = parseTaskEvent(entry);
      if (event) events.push(event);
    }
  }
  return { task, events };
}

/**
 * The task list, or null when it could not be read (offline, refused, no
 * gateway). `readJson` folds every failure into its fallback, so a null
 * fallback is how a failed read stays apart from an empty ledger.
 */
export function taskListPath(opts?: { states?: TaskState[]; limit?: number; root?: string }) {
  const query: string[] = [];
  if (opts?.states?.length) query.push(`state=${opts.states.join(',')}`);
  if (opts?.limit !== undefined) query.push(`limit=${opts.limit}`);
  if (opts?.root) query.push(`root=${encodeURIComponent(opts.root)}`);
  return `/api/tasks${query.length ? `?${query.join('&')}` : ''}`;
}

/** A computer that is not the selected one, asked through its own stored address. */
export interface TaskEndpoint {
  url: string;
  token: string;
  deviceId?: string;
  transportKey?: string;
  transport?: string;
}

export async function fetchTaskList(opts?: {
  states?: TaskState[];
  limit?: number;
  root?: string;
  /** Ask this computer directly instead of the shared client's. */
  endpoint?: TaskEndpoint;
}): Promise<TaskView[] | null> {
  const path = taskListPath(opts);
  if (opts?.endpoint) {
    try {
      const response = await endpointRequest(opts.endpoint, path, 'GET');
      return response.ok ? parseTaskList(await response.json()) : null;
    } catch {
      return null;
    }
  }
  const { readJson } = await import('./agent-session');
  return readJson<TaskView[] | null>(path, parseTaskList, null);
}

/**
 * Open a ledger task on the selected computer: the gateway creates the agent
 * session, sends the goal and records the task in one step.
 */
export async function createLedgerTask(
  request: LedgerTaskRequest
): Promise<{ task: TaskView; asid: string }> {
  const { postLedgerTask } = await import('./gateway-client');
  const created = parseCreatedLedgerTask(await postLedgerTask(ledgerTaskBody(request)));
  if (!created) throw new Error('The computer did not say which session it opened.');
  return created;
}

async function endpointRequest(
  endpoint: TaskEndpoint,
  path: string,
  method: 'GET' | 'POST'
): Promise<Response> {
  const { gatewayEndpointFetch } = await import('./gateway-client');
  const base = endpoint.url.replace(/\/$/, '');
  return gatewayEndpointFetch(
    endpoint as Parameters<typeof gatewayEndpointFetch>[0],
    `${base}${path}`,
    { method, headers: { Authorization: `Bearer ${endpoint.token}` } }
  );
}

export async function getTask(
  taskId: string,
  endpoint?: TaskEndpoint
): Promise<{ task: TaskView; events: TaskEvent[] } | null> {
  const path = `/api/tasks/${encodeURIComponent(taskId)}`;
  if (endpoint) {
    try {
      const response = await endpointRequest(endpoint, path, 'GET');
      return response.ok ? parseTaskDetail(await response.json()) : null;
    } catch {
      return null;
    }
  }
  const { readJson } = await import('./agent-session');
  return readJson(path, parseTaskDetail, null);
}

/** The task as the gateway now has it; null when it no longer knows the task. */
export async function cancelTask(
  taskId: string,
  endpoint?: TaskEndpoint
): Promise<TaskView | null> {
  const path = `/api/tasks/${encodeURIComponent(taskId)}/cancel`;
  if (endpoint) {
    const response = await endpointRequest(endpoint, path, 'POST');
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cancel task: ${response.status} ${await response.text()}`);
    const body = (await response.json()) as unknown;
    const data = asRecord(body)?.data;
    return parseTaskView(data ?? body);
  }
  const { writeJson } = await import('./agent-session');
  try {
    return parseTaskView(await writeJson(path, 'Cancel task'));
  } catch (error) {
    if (error instanceof Error && /: 404\b/.test(error.message)) return null;
    throw error;
  }
}
