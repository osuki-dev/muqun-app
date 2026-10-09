import { asFiniteNumber, asRecord, asString } from './agent-protocol';

/** The gateway announces this when it keeps a task ledger. */
export const TASK_LEDGER_CAPABILITY = 'task_ledger';

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

export interface TaskView {
  taskId: string;
  state: TaskState;
  kind: TaskKind;
  goal: string;
  summary?: string;
  exitCode?: number;
  binding: TaskBinding;
  updatedMs: number;
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

/** A task as the gateway spells it (snake_case); null for a state this build cannot name. */
export function parseTaskView(value: unknown): TaskView | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const taskId = asString(rec.task_id);
  const state = parseState(rec.state);
  if (!taskId || !state) return null;
  const summary = asString(rec.summary);
  const exitCode = asFiniteNumber(rec.exit_code);
  return {
    taskId,
    state,
    kind: rec.kind === 'command' ? 'command' : 'delegation',
    goal: asString(rec.goal) ?? '',
    ...(summary ? { summary } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    binding: parseBinding(rec.binding),
    updatedMs: asFiniteNumber(rec.updated_ms) ?? 0,
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
export async function fetchTaskList(opts?: {
  states?: TaskState[];
  limit?: number;
}): Promise<TaskView[] | null> {
  const { readJson } = await import('./agent-session');
  const { demoTasks, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return parseTaskList({ tasks: demoTasks(opts?.states, opts?.limit) });
  const query: string[] = [];
  if (opts?.states?.length) query.push(`state=${opts.states.join(',')}`);
  if (opts?.limit !== undefined) query.push(`limit=${opts.limit}`);
  const path = `/api/tasks${query.length ? `?${query.join('&')}` : ''}`;
  return readJson<TaskView[] | null>(path, parseTaskList, null);
}

export async function getTask(
  taskId: string
): Promise<{ task: TaskView; events: TaskEvent[] } | null> {
  const { readJson } = await import('./agent-session');
  const { demoTaskDetail, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return parseTaskDetail(demoTaskDetail(taskId));
  return readJson(`/api/tasks/${encodeURIComponent(taskId)}`, parseTaskDetail, null);
}

/** The task as the gateway now has it; null when it no longer knows the task. */
export async function cancelTask(taskId: string): Promise<TaskView | null> {
  const { writeJson } = await import('./agent-session');
  const { demoCancelTask, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return parseTaskView(demoCancelTask(taskId));
  try {
    return parseTaskView(
      await writeJson(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, 'Cancel task')
    );
  } catch (error) {
    if (error instanceof Error && /: 404\b/.test(error.message)) return null;
    throw error;
  }
}
