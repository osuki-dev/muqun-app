import { asFiniteNumber, asRecord, asString } from './agent-protocol';

/** The gateway announces this when it keeps a task ledger. */
export const TASK_LEDGER_CAPABILITY = 'task_ledger';

/**
 * The gateway opens a ledger task from the device (`POST /api/tasks`) and
 * serves the task tree: `parent_task_id`, `children`, `origin`, `?root=`.
 */
export const TASK_LEDGER_CREATE_CAPABILITY = 'task_ledger_create';

/**
 * `POST /api/tasks` also takes a terminal agent (Codex, Claude Code, ...): the
 * gateway opens a pane for it, types the goal and follows it as a ledger task.
 */
export const TASK_LEDGER_PANE_CAPABILITY = 'task_ledger_pane';

/** `{"t":"subscribe_tasks"}` on `/api/ws`: task frames without any session's traffic. */
export const TASK_WS_SUBSCRIPTION_CAPABILITY = 'task_ws_subscription';

/** `POST /api/tasks/{id}/complete`: the device confirms a paused task is done. */
export const TASK_LEDGER_COMPLETE_CAPABILITY = 'task_ledger_complete';

/**
 * The gateway reports where a task this device opens without a folder runs:
 * the `defaults` frame and `GET /api/tasks/defaults` (Gateway Task 20).
 */
export const TASK_DEFAULTS_CAPABILITY = 'task_defaults';

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
  | {
      kind: 'pane';
      sessionId: string;
      paneId: string;
      tabId?: string;
      shellPid?: number;
      /** Set for a terminal agent the task started; absent for a command. */
      agentId?: string;
    }
  | {
      /**
       * A mirror of work another of the reader's computers runs (`fleet_peers`).
       * `peerId` is the mirroring gateway's own id for that link; `peerServerId`
       * is the other computer's server id when the gateway says it.
       */
      kind: 'peer';
      peerId: string;
      /** Empty while the computer over there has not said which task it opened. */
      remoteTaskId: string;
      peerServerId?: string;
      /** What the mirroring gateway calls that computer: a fallback name (§10.13). */
      peerName?: string;
    };

export type TaskOrigin = 'device' | 'agent' | 'mcp' | 'peer';

/** Who opened a task: a device of the reader's, another computer, or an assistant. */
export type RequesterKind = 'device' | 'gateway' | 'assistant';

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
  /** What a working task is doing right now, one short line (Gateway Task 17). */
  progress?: string;
  exitCode?: number;
  binding: TaskBinding;
  updatedMs: number;
  /** The open task this one was started from (task tree gateways only). */
  parentTaskId?: string;
  origin?: TaskOrigin;
  /** The title the requester gave. */
  label?: string;
  /**
   * One line naming the task, derived by the gateway: the label, else the
   * agent session's own name, else the goal's first sentence. Absent before
   * Gateway Task 20.
   */
  title?: string;
  /** Who opened it: the device for `origin: device`, the computer for `origin: peer`. */
  requestedBy?: { id: string; name: string; kind?: RequesterKind; serverId?: string };
  /** A mirror only: whether its computer answered lately (§10.12). */
  peerReachable?: boolean;
  /** A mirror only: when its computer last answered. */
  peerLastSeenMs?: number;
  children?: TaskChildren;
  /**
   * This device's clock when the reader settled the task here (Mark done,
   * Cancel), before the gateway answered. Local only; never on the wire.
   */
  settledAtMs?: number;
  /** This device's clock when the view reached it (frame or answer). Local only. */
  receivedAtMs?: number;
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
      const agentId = asString(rec.agent_id);
      return {
        kind: 'pane',
        sessionId,
        paneId,
        ...(tabId ? { tabId } : {}),
        ...(shellPid !== undefined ? { shellPid } : {}),
        ...(agentId ? { agentId } : {}),
      };
    }
  } else if (rec.kind === 'peer') {
    const peerId = asString(rec.peer_id);
    const peerServerId = asString(rec.peer_server_id);
    const peerName = asString(rec.peer_name)?.trim();
    if (peerId) {
      return {
        kind: 'peer',
        peerId,
        remoteTaskId: asString(rec.remote_task_id) ?? '',
        ...(peerServerId ? { peerServerId } : {}),
        ...(peerName ? { peerName } : {}),
      };
    }
  }
  return { kind: 'none' };
}

function parseOrigin(value: unknown): TaskOrigin | undefined {
  return value === 'device' || value === 'agent' || value === 'mcp' || value === 'peer'
    ? value
    : undefined;
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

function parseRequester(value: unknown): TaskView['requestedBy'] {
  const rec = asRecord(value);
  const id = asString(rec?.id);
  if (!rec || !id) return undefined;
  const kind = rec.kind;
  const serverId = asString(rec.server_id);
  return {
    id,
    name: asString(rec.name) ?? '',
    ...(kind === 'device' || kind === 'gateway' || kind === 'assistant' ? { kind } : {}),
    ...(serverId ? { serverId } : {}),
  };
}

/** A task as the gateway spells it (snake_case); null for a state this build cannot name. */
export function parseTaskView(value: unknown): TaskView | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const taskId = asString(rec.task_id);
  const state = parseState(rec.state);
  if (!taskId || !state) return null;
  const summary = asString(rec.summary);
  const progress = asString(rec.progress)?.trim().slice(0, 120);
  const exitCode = asFiniteNumber(rec.exit_code);
  const parentTaskId = asString(rec.parent_task_id);
  const origin = parseOrigin(rec.origin);
  const label = asString(rec.label)?.trim();
  const title = asString(rec.title)?.trim();
  const requestedBy = parseRequester(rec.requested_by);
  const children = parseChildren(rec.children);
  const peerLastSeenMs = asFiniteNumber(rec.peer_last_seen_ms);
  return {
    taskId,
    state,
    kind: rec.kind === 'command' ? 'command' : 'delegation',
    goal: asString(rec.goal) ?? '',
    ...(summary ? { summary } : {}),
    ...(progress ? { progress } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    binding: parseBinding(rec.binding),
    updatedMs: asFiniteNumber(rec.updated_ms) ?? 0,
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(origin ? { origin } : {}),
    ...(label ? { label } : {}),
    ...(title ? { title } : {}),
    ...(requestedBy ? { requestedBy } : {}),
    ...(children ? { children } : {}),
    ...(typeof rec.peer_reachable === 'boolean' ? { peerReachable: rec.peer_reachable } : {}),
    ...(peerLastSeenMs !== undefined ? { peerLastSeenMs } : {}),
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

/**
 * Whether the reader can say a task is done, on a gateway that takes the
 * confirmation: one this device's owner opened, stopped without saying it
 * finished (`idle_unconfirmed`) or asking (`waiting`); or a mirror of work on
 * another computer in any open state -- that computer may have gone quiet,
 * and the reader decides (§10.11). Settling a mirror settles only the mirror.
 */
export function canMarkTaskDone(
  task: TaskView,
  capabilities: readonly string[] | undefined
): boolean {
  if (capabilities?.includes(TASK_LEDGER_COMPLETE_CAPABILITY) !== true) return false;
  if (task.binding.kind === 'peer') return !isTerminalTaskState(task.state);
  return (
    task.origin === 'device' && (task.state === 'idle_unconfirmed' || task.state === 'waiting')
  );
}

/** What `POST /api/tasks` takes. `model` is a catalog id or `provider_id/model_id`. */
export interface LedgerTaskRequest {
  goal: string;
  agentId?: string;
  cwd?: string;
  mode?: string;
  model?: string;
  /** The model variant (reasoning effort), applied at session creation. */
  variant?: string;
  label?: string;
}

export function ledgerTaskBody(request: LedgerTaskRequest): Record<string, string> {
  return {
    goal: request.goal,
    ...(request.agentId ? { agent_id: request.agentId } : {}),
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.mode ? { mode: request.mode } : {}),
    ...(request.model ? { model: request.model } : {}),
    ...(request.model && request.variant ? { variant: request.variant } : {}),
    ...(request.label?.trim() ? { label: request.label.trim() } : {}),
  };
}

export type CreatedLedgerTask = { task: TaskView; asid?: string; paneId?: string };

/**
 * The answer to `POST /api/tasks`: the task, flattened, plus the session or,
 * for a terminal agent, the pane it opened -- which a task that failed while
 * being opened may not have.
 */
export function parseCreatedLedgerTask(value: unknown): CreatedLedgerTask | null {
  const task = parseTaskView(value);
  if (!task) return null;
  const rec = asRecord(value);
  const asid =
    asString(rec?.asid) ?? (task.binding.kind === 'agent_session' ? task.binding.asid : undefined);
  const paneId =
    asString(rec?.pane_id) ?? (task.binding.kind === 'pane' ? task.binding.paneId : undefined);
  return { task, ...(asid ? { asid } : {}), ...(paneId ? { paneId } : {}) };
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
 * `GET /api/tasks/defaults`: the folder a task this device opens without a
 * `cwd` runs in, for a gateway whose task socket is not available. `null`
 * when the gateway cannot say -- an older one has no such route -- or the
 * read failed.
 */
export async function fetchTaskDefaultCwd(endpoint?: TaskEndpoint): Promise<string | null> {
  const parse = (value: unknown) => asString(asRecord(value)?.default_cwd) || null;
  const path = '/api/tasks/defaults';
  if (endpoint) {
    try {
      const response = await endpointRequest(endpoint, path, 'GET');
      return response.ok ? parse(await response.json()) : null;
    } catch {
      return null;
    }
  }
  const { readJson } = await import('./agent-session');
  return readJson<string | null>(path, parse, null);
}

/**
 * Open a ledger task on the selected computer: the gateway creates the agent
 * session, sends the goal and records the task in one step. `null` when the
 * answer does not say which task it opened; the caller words that.
 */
export async function createLedgerTask(
  request: LedgerTaskRequest
): Promise<CreatedLedgerTask | null> {
  const { postLedgerTask } = await import('./gateway-client');
  return parseCreatedLedgerTask(await postLedgerTask(ledgerTaskBody(request)));
}

/**
 * `GET /api/tasks/{id}`: one task as its computer has it now, or `null` when
 * that computer does not know it or did not answer.
 */
export async function fetchTaskView(
  taskId: string,
  endpoint?: TaskEndpoint
): Promise<TaskView | null> {
  const path = `/api/tasks/${encodeURIComponent(taskId)}`;
  const parse = (value: unknown) => parseTaskView(asRecord(value)?.task ?? value);
  if (endpoint) {
    try {
      const response = await endpointRequest(endpoint, path, 'GET');
      return response.ok ? parse(await response.json()) : null;
    } catch {
      return null;
    }
  }
  const { readJson } = await import('./agent-session');
  return readJson<TaskView | null>(path, parse, null);
}

async function endpointRequest(
  endpoint: TaskEndpoint,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<Response> {
  const { gatewayEndpointFetch } = await import('./gateway-client');
  const base = endpoint.url.replace(/\/$/, '');
  return gatewayEndpointFetch(
    endpoint as Parameters<typeof gatewayEndpointFetch>[0],
    `${base}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
}

/**
 * Stop an open task (the device route): the task as the gateway now has it,
 * or null when it no longer knows the task.
 */
export async function cancelTask(
  taskId: string,
  endpoint?: TaskEndpoint
): Promise<TaskView | null> {
  return postTaskAction(taskId, 'cancel', 'Cancel task', endpoint);
}

/**
 * Confirm a paused task is done (`task_ledger_complete`). The task as the
 * gateway now has it; null when the answer did not carry one.
 */
export async function completeTask(
  taskId: string,
  endpoint?: TaskEndpoint
): Promise<TaskView | null> {
  return postTaskAction(taskId, 'complete', 'Complete task', endpoint);
}

async function postTaskAction(
  taskId: string,
  action: 'cancel' | 'complete',
  what: string,
  endpoint?: TaskEndpoint
): Promise<TaskView | null> {
  const path = `/api/tasks/${encodeURIComponent(taskId)}/${action}`;
  if (endpoint) {
    const response = await endpointRequest(endpoint, path, 'POST', {});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${what}: ${response.status} ${await response.text()}`);
    const body = (await response.json().catch(() => null)) as unknown;
    return parseTaskView(asRecord(body)?.data ?? body);
  }
  const { writeJson } = await import('./agent-session');
  return writeJson(path, what, {}).then(parseTaskView, (error: unknown) => {
    if (error instanceof Error && /: 404\b/.test(error.message)) return null;
    throw error;
  });
}
