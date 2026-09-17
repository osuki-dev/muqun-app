/**
 * The agent wire contract, as types and as tolerant parsers.
 *
 * Deliberately free of any React Native import so it can be unit tested
 * directly: `agent-session.ts` owns the fetching and re-exports everything
 * here, but nothing here knows what a fetch is.
 *
 * Two rules hold for every function in this file.
 *
 * **Everything takes `unknown`.** The gateway is a program on someone else's
 * machine, running a version this build has never seen; a field that is a
 * string today is a number in the next release, and the phone must show
 * whatever it can of the rest rather than a red screen.
 *
 * **Nothing throws, and nothing asserts.** No `!`, no `as` onto a shape that
 * was not checked. A row that cannot be understood comes back `null` and is
 * dropped by the caller, which is the only honest thing to do with it.
 *
 * The field names are the gateway's own (snake_case), with the two documented
 * exceptions carried verbatim: a tool call's `metadata` and `content` are
 * OpenCode's payloads and stay camelCase.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
  }
  return out;
}

/** The first of `keys` that holds a non-empty string. */
function pickString(rec: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

/** An error as every agent payload spells it. `status` is an HTTP-ish code. */
export interface AgentErrorInfo {
  name: string;
  message: string;
  status?: number;
}

export function parseAgentError(value: unknown): AgentErrorInfo | undefined {
  const rec = asRecord(value);
  if (!rec) {
    // A bare string is not the documented shape, but a gateway that sends one
    // is still saying something the reader should see.
    const bare = asString(value);
    return bare ? { name: 'unknown', message: bare } : undefined;
  }
  const message = pickString(rec, ['message', 'error', 'detail']) ?? '';
  const name = pickString(rec, ['name', 'code']) ?? 'unknown';
  if (!message && name === 'unknown') return undefined;
  const status = asFiniteNumber(rec.status);
  return status === undefined ? { name, message } : { name, message, status };
}

export interface ModelRef {
  provider_id: string;
  model_id: string;
  /** Optional and omitted, never null — the contract is explicit about it. */
  variant?: string;
}

export function parseModelRef(value: unknown): ModelRef | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const providerId = pickString(rec, ['provider_id', 'providerID', 'provider']);
  const modelId = pickString(rec, ['model_id', 'modelID', 'model']);
  if (!providerId || !modelId) return null;
  const variant = pickString(rec, ['variant']);
  return variant
    ? { provider_id: providerId, model_id: modelId, variant }
    : {
        provider_id: providerId,
        model_id: modelId,
      };
}

export interface TokensUsage {
  input: number;
  output: number;
  reasoning?: number;
  cache_read?: number;
  cache_write?: number;
}

export function parseTokensUsage(value: unknown): TokensUsage | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const cache = asRecord(rec.cache);
  const usage: TokensUsage = {
    input: asFiniteNumber(rec.input) ?? 0,
    output: asFiniteNumber(rec.output) ?? 0,
  };
  const reasoning = asFiniteNumber(rec.reasoning);
  if (reasoning !== undefined) usage.reasoning = reasoning;
  // `…/context` nests the two cache counters; `AgentSessionInfo` flattens them.
  const cacheRead = asFiniteNumber(rec.cache_read) ?? asFiniteNumber(cache?.read);
  const cacheWrite = asFiniteNumber(rec.cache_write) ?? asFiniteNumber(cache?.write);
  if (cacheRead !== undefined) usage.cache_read = cacheRead;
  if (cacheWrite !== undefined) usage.cache_write = cacheWrite;
  return usage;
}

export interface ContextLimit {
  context?: number;
  output?: number;
  input?: number;
}

export function parseContextLimit(value: unknown): ContextLimit | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const limit: ContextLimit = {};
  const context = asFiniteNumber(rec.context);
  const output = asFiniteNumber(rec.output);
  const input = asFiniteNumber(rec.input);
  if (context !== undefined) limit.context = context;
  if (output !== undefined) limit.output = output;
  if (input !== undefined) limit.input = input;
  return context === undefined && output === undefined && input === undefined ? undefined : limit;
}

// ---------------------------------------------------------------------------
// Session info
// ---------------------------------------------------------------------------

/**
 * The run state of one agent session, in the gateway's own vocabulary.
 *
 * `busy`/`idle` come from `session.execution.*`; `failed` carries an error;
 * `interrupted` is what an abort produces; `retry` is a scheduled retry, which
 * may also carry the error that caused it. `unknown` is the honest answer when
 * the engine has not said, and it is never rendered as idle.
 */
export type AgentRunStatus = 'busy' | 'idle' | 'failed' | 'interrupted' | 'retry' | 'unknown';

const RUN_STATUSES: readonly AgentRunStatus[] = [
  'busy',
  'idle',
  'failed',
  'interrupted',
  'retry',
  'unknown',
];

/**
 * Status, with the older spellings this app used to send accepted on the way
 * in so a session that was cached before the rename still reads.
 */
export function parseRunStatus(value: unknown): AgentRunStatus {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return 'unknown';
  if ((RUN_STATUSES as readonly string[]).includes(raw)) return raw as AgentRunStatus;
  if (raw === 'running' || raw === 'working') return 'busy';
  if (raw === 'error' || raw === 'failure') return 'failed';
  if (raw === 'paused' || raw === 'aborted' || raw === 'terminated') return 'interrupted';
  return 'unknown';
}

/** Whether the agent loop is doing something right now. */
export function isBusyStatus(status: AgentRunStatus | undefined): boolean {
  return status === 'busy' || status === 'retry';
}

export interface AgentSessionRevert {
  message_id?: string;
  part_id?: string;
  snapshot?: string;
  files?: string[];
}

export interface AgentSessionFork {
  session_id?: string;
  boundary_type?: string;
  message_id?: string;
}

export interface AgentSessionInfo {
  asid: string;
  backend_session_id: string;
  title: string;
  agent?: string;
  /**
   * `null` when OpenCode has not said which model this session runs on. The
   * gateway does not invent one, and neither does the app: a picker showing a
   * model the session is not using is worse than a picker showing nothing.
   */
  model: ModelRef | null;
  status: AgentRunStatus;
  directory?: string;
  cost?: number;
  tokens?: TokensUsage;
  limit?: ContextLimit;
  parent_id?: string;
  project_id?: string;
  /** How the last run ended, when OpenCode reported it. */
  outcome?: string;
  error?: AgentErrorInfo;
  /** Set while a rollback is staged; clearing it is redo. */
  revert?: AgentSessionRevert;
  fork?: AgentSessionFork;
  time_idle?: number;
  time_viewed?: number;
  deleted?: boolean;
  updated_ms: number;
}

export function parseAgentSessionInfo(value: unknown): AgentSessionInfo | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const asid = pickString(rec, ['asid', 'id', 'session_id', 'sessionID']);
  if (!asid) return null;

  const info: AgentSessionInfo = {
    asid,
    backend_session_id: pickString(rec, ['backend_session_id']) ?? asid,
    title: asString(rec.title) ?? '',
    model: parseModelRef(rec.model),
    status: parseRunStatus(rec.status),
    updated_ms: asFiniteNumber(rec.updated_ms) ?? 0,
  };

  const agent = pickString(rec, ['agent']);
  if (agent) info.agent = agent;
  const directory = pickString(rec, ['directory']);
  if (directory) info.directory = directory;
  const cost = asFiniteNumber(rec.cost);
  if (cost !== undefined) info.cost = cost;
  const tokens = parseTokensUsage(rec.tokens);
  if (tokens) info.tokens = tokens;
  const limit = parseContextLimit(rec.limit);
  if (limit) info.limit = limit;
  const parentId = pickString(rec, ['parent_id', 'parentID']);
  if (parentId) info.parent_id = parentId;
  const projectId = pickString(rec, ['project_id', 'projectID']);
  if (projectId) info.project_id = projectId;
  const outcome = pickString(rec, ['outcome']);
  if (outcome) info.outcome = outcome;
  const error = parseAgentError(rec.error);
  if (error) info.error = error;

  const revert = asRecord(rec.revert);
  if (revert) {
    const staged: AgentSessionRevert = {};
    const messageId = pickString(revert, ['message_id', 'messageID']);
    if (messageId) staged.message_id = messageId;
    const partId = pickString(revert, ['part_id', 'partID']);
    if (partId) staged.part_id = partId;
    const snapshot = pickString(revert, ['snapshot']);
    if (snapshot) staged.snapshot = snapshot;
    const files = asStringArray(revert.files);
    if (files.length > 0) staged.files = files;
    info.revert = staged;
  }

  const fork = asRecord(rec.fork);
  if (fork) {
    const forked: AgentSessionFork = {};
    const sessionId = pickString(fork, ['session_id', 'sessionID']);
    if (sessionId) forked.session_id = sessionId;
    const boundary = pickString(fork, ['boundary_type', 'boundaryType']);
    if (boundary) forked.boundary_type = boundary;
    const messageId = pickString(fork, ['message_id', 'messageID']);
    if (messageId) forked.message_id = messageId;
    info.fork = forked;
  }

  const timeIdle = asFiniteNumber(rec.time_idle);
  if (timeIdle !== undefined) info.time_idle = timeIdle;
  const timeViewed = asFiniteNumber(rec.time_viewed);
  if (timeViewed !== undefined) info.time_viewed = timeViewed;
  if (rec.deleted === true) info.deleted = true;

  return info;
}

export function parseAgentSessionList(value: unknown): AgentSessionInfo[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.sessions)
      ? (asRecord(value)?.sessions as unknown[])
      : [];
  const out: AgentSessionInfo[] = [];
  for (const entry of list) {
    const info = parseAgentSessionInfo(entry);
    if (info) out.push(info);
  }
  return out;
}

/** Unread is `time_idle > time_viewed`, and only when both are known. */
export function isSessionUnread(info: AgentSessionInfo): boolean {
  if (info.time_idle === undefined) return false;
  return info.time_idle > (info.time_viewed ?? 0);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionDecision = 'allow' | 'allow_always' | 'deny';

export function parsePermissionDecision(value: unknown): PermissionDecision {
  const raw = asString(value)?.toLowerCase();
  if (raw === 'allow_always' || raw === 'always') return 'allow_always';
  if (raw === 'deny' || raw === 'reject') return 'deny';
  return 'allow';
}

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
  /** What an "always" would whitelist project-wide; shown next to the option. */
  save: string[];
  prompt: string;
  tool?: string;
  source_message_id?: string;
  /** Matches a tool row's `part.id`, so the card attaches to the exact call. */
  source_tool_call_id?: string;
  metadata?: Record<string, unknown>;
  message?: string;
  options: PermissionOption[];
}

/**
 * The three answers a permission always has, for a request that arrived
 * without an `options[]` of its own.
 *
 * Decisions, not labels: the wording is the card's, through a macro, because a
 * pure module cannot hold one and an English string baked in here would render
 * in English in all eight languages.
 */
export const DEFAULT_PERMISSION_DECISIONS: readonly PermissionDecision[] = Object.freeze([
  'allow',
  'allow_always',
  'deny',
]);

export function parsePermissionRequest(value: unknown): PermissionRequest | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = pickString(rec, ['id', 'request_id', 'requestID']);
  if (!id) return null;

  const options: PermissionOption[] = [];
  if (Array.isArray(rec.options)) {
    for (const entry of rec.options) {
      const optionRec = asRecord(entry);
      if (!optionRec) continue;
      const label = pickString(optionRec, ['label', 'title', 'name']);
      if (!label) continue;
      options.push({
        index: asFiniteNumber(optionRec.index) ?? options.length,
        label,
        decision: parsePermissionDecision(optionRec.decision),
      });
    }
  }

  const request: PermissionRequest = {
    id,
    asid: pickString(rec, ['asid', 'session_id', 'sessionID']) ?? '',
    action: asString(rec.action) ?? '',
    resources: asStringArray(rec.resources),
    save: asStringArray(rec.save),
    prompt: asString(rec.prompt) ?? '',
    // Empty means "the engine offered no menu of its own", which is the card's
    // cue to draw the three every permission has in the reader's language.
    options,
  };

  const tool = pickString(rec, ['tool']);
  if (tool) request.tool = tool;
  const sourceMessageId = pickString(rec, ['source_message_id', 'sourceMessageID']);
  if (sourceMessageId) request.source_message_id = sourceMessageId;
  const sourceToolCallId = pickString(rec, ['source_tool_call_id', 'sourceToolCallID']);
  if (sourceToolCallId) request.source_tool_call_id = sourceToolCallId;
  const metadata = asRecord(rec.metadata);
  if (metadata) request.metadata = metadata;
  const message = pickString(rec, ['message']);
  if (message) request.message = message;

  return request;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

export type FormConditionOp = 'eq' | 'neq';

/** A field is hidden unless every one of these holds against the answers. */
export interface FormCondition {
  key: string;
  op: FormConditionOp;
  value: unknown;
}

export type FormFieldFormat = 'email' | 'uri' | 'date' | 'date-time';

interface FormFieldBase {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  when: FormCondition[];
}

export type FormField =
  | (FormFieldBase & {
      type: 'string';
      placeholder?: string;
      default?: string;
      options?: FormOption[];
      format?: FormFieldFormat;
      min_length?: number;
      max_length?: number;
      pattern?: string;
      /** A value outside `options` is allowed. */
      custom?: boolean;
    })
  | (FormFieldBase & { type: 'number'; min?: number; max?: number; default?: number })
  | (FormFieldBase & { type: 'boolean'; default?: boolean })
  | (FormFieldBase & { type: 'multiselect'; options: FormOption[]; default?: string[] })
  | (FormFieldBase & { type: 'external'; url: string })
  | (FormFieldBase & { type: 'unknown'; raw_type: string });

export interface FormRequest {
  id: string;
  asid: string;
  title: string;
  fields: FormField[];
}

function parseFormOptions(value: unknown): FormOption[] {
  if (!Array.isArray(value)) return [];
  const out: FormOption[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) {
      const bare = asString(entry);
      if (bare) out.push({ value: bare, label: bare });
      continue;
    }
    const optionValue = asString(rec.value) ?? asString(rec.id);
    if (optionValue === undefined) continue;
    const description = pickString(rec, ['description']);
    out.push({
      value: optionValue,
      label: pickString(rec, ['label', 'title', 'name']) ?? optionValue,
      ...(description ? { description } : {}),
    });
  }
  return out;
}

function parseFormConditions(value: unknown): FormCondition[] {
  if (!Array.isArray(value)) return [];
  const out: FormCondition[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const key = asString(rec.key);
    if (!key) continue;
    out.push({ key, op: asString(rec.op) === 'neq' ? 'neq' : 'eq', value: rec.value });
  }
  return out;
}

const FORM_FORMATS: readonly FormFieldFormat[] = ['email', 'uri', 'date', 'date-time'];

export function parseFormField(value: unknown): FormField | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const key = asString(rec.key);
  if (!key) return null;
  const rawType = asString(rec.type) ?? 'unknown';
  const description = pickString(rec, ['description']);
  const base: FormFieldBase = {
    key,
    title: asString(rec.title) ?? key,
    ...(description ? { description } : {}),
    ...(rec.required === true ? { required: true } : {}),
    when: parseFormConditions(rec.when),
  };

  switch (rawType) {
    case 'string': {
      const field: Extract<FormField, { type: 'string' }> = { ...base, type: 'string' };
      const placeholder = pickString(rec, ['placeholder']);
      if (placeholder) field.placeholder = placeholder;
      const fallback = asString(rec.default);
      if (fallback !== undefined) field.default = fallback;
      const options = parseFormOptions(rec.options);
      if (options.length > 0) field.options = options;
      const format = asString(rec.format);
      if (format && (FORM_FORMATS as readonly string[]).includes(format)) {
        field.format = format as FormFieldFormat;
      }
      const minLength = asFiniteNumber(rec.min_length);
      if (minLength !== undefined) field.min_length = minLength;
      const maxLength = asFiniteNumber(rec.max_length);
      if (maxLength !== undefined) field.max_length = maxLength;
      const pattern = pickString(rec, ['pattern']);
      if (pattern) field.pattern = pattern;
      if (rec.custom === true) field.custom = true;
      return field;
    }
    case 'number': {
      const field: Extract<FormField, { type: 'number' }> = { ...base, type: 'number' };
      const min = asFiniteNumber(rec.min);
      if (min !== undefined) field.min = min;
      const max = asFiniteNumber(rec.max);
      if (max !== undefined) field.max = max;
      const fallback = asFiniteNumber(rec.default);
      if (fallback !== undefined) field.default = fallback;
      return field;
    }
    case 'boolean': {
      const field: Extract<FormField, { type: 'boolean' }> = { ...base, type: 'boolean' };
      const fallback = asBool(rec.default);
      if (fallback !== undefined) field.default = fallback;
      return field;
    }
    case 'multiselect': {
      const field: Extract<FormField, { type: 'multiselect' }> = {
        ...base,
        type: 'multiselect',
        options: parseFormOptions(rec.options),
      };
      const fallback = asStringArray(rec.default);
      if (fallback.length > 0) field.default = fallback;
      return field;
    }
    case 'external': {
      const url = asString(rec.url);
      // An external field with no link is a button that goes nowhere; it is
      // more useful as the unknown field it effectively is.
      if (url) return { ...base, type: 'external', url };
      return { ...base, type: 'unknown', raw_type: rawType };
    }
    default:
      return { ...base, type: 'unknown', raw_type: rawType };
  }
}

export function parseFormRequest(value: unknown): FormRequest | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = pickString(rec, ['id', 'form_id', 'formID']);
  if (!id) return null;
  const fields: FormField[] = [];
  if (Array.isArray(rec.fields)) {
    for (const entry of rec.fields) {
      const field = parseFormField(entry);
      if (field) fields.push(field);
    }
  }
  return {
    id,
    asid: pickString(rec, ['asid', 'session_id', 'sessionID']) ?? '',
    title: asString(rec.title) ?? '',
    fields,
  };
}

/** Whether every `when` condition on a field holds against the answers so far. */
export function isFormFieldVisible(
  field: FormField,
  answers: Readonly<Record<string, unknown>>
): boolean {
  for (const condition of field.when) {
    const actual = answers[condition.key];
    const matches = actual === condition.value;
    if (condition.op === 'eq' ? !matches : matches) return false;
  }
  return true;
}

/**
 * Why an answer is not acceptable, or `null`.
 *
 * Returns a machine-readable reason rather than a sentence, because the
 * sentence is the caller's to translate.
 */
export type FormFieldViolation =
  | { reason: 'required' }
  | { reason: 'min_length'; limit: number }
  | { reason: 'max_length'; limit: number }
  | { reason: 'pattern'; pattern: string }
  | { reason: 'format'; format: FormFieldFormat }
  | { reason: 'min'; limit: number }
  | { reason: 'max'; limit: number };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_SHAPE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}/;

function matchesFormat(format: FormFieldFormat, text: string): boolean {
  switch (format) {
    case 'email':
      return EMAIL_SHAPE.test(text);
    case 'uri':
      // `URL` is not available in every runtime this ships to, and a scheme
      // followed by something is the part a form needs to insist on.
      return (
        /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(text) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/.test(text)
      );
    case 'date':
      return DATE_SHAPE.test(text);
    case 'date-time':
      return DATE_TIME_SHAPE.test(text);
  }
}

export function validateFormField(field: FormField, value: unknown): FormFieldViolation | null {
  if (field.type === 'external' || field.type === 'unknown') return null;

  const empty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return field.required ? { reason: 'required' } : null;

  if (field.type === 'string') {
    const text = typeof value === 'string' ? value : String(value);
    if (field.min_length !== undefined && text.length < field.min_length) {
      return { reason: 'min_length', limit: field.min_length };
    }
    if (field.max_length !== undefined && text.length > field.max_length) {
      return { reason: 'max_length', limit: field.max_length };
    }
    if (field.pattern) {
      // A pattern the engine sent is untrusted input; an invalid one must not
      // take the composer down with it.
      try {
        if (!new RegExp(field.pattern).test(text)) {
          return { reason: 'pattern', pattern: field.pattern };
        }
      } catch {
        // An unparseable pattern cannot reject anything.
      }
    }
    if (field.format && !matchesFormat(field.format, text)) {
      return { reason: 'format', format: field.format };
    }
    return null;
  }

  if (field.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return field.required ? { reason: 'required' } : null;
    if (field.min !== undefined && numeric < field.min) return { reason: 'min', limit: field.min };
    if (field.max !== undefined && numeric > field.max) return { reason: 'max', limit: field.max };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Timeline parts
// ---------------------------------------------------------------------------

export interface TodoItem {
  text: string;
  done: boolean;
}

/** OpenCode's own tool lifecycle. `status` is the previous release's name. */
export type ToolCallState = 'pending' | 'streaming' | 'running' | 'completed' | 'failed';

const TOOL_STATES: readonly ToolCallState[] = [
  'pending',
  'streaming',
  'running',
  'completed',
  'failed',
];

export function parseToolState(value: unknown): ToolCallState {
  const raw = asString(value)?.toLowerCase();
  if (raw && (TOOL_STATES as readonly string[]).includes(raw)) return raw as ToolCallState;
  if (raw === 'error') return 'failed';
  if (raw === 'success' || raw === 'done' || raw === 'ok') return 'completed';
  return 'running';
}

export interface ToolTiming {
  created?: number;
  ran?: number;
  completed?: number;
}

/** One entry of `Tool.Content[]`, forwarded verbatim by the gateway. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'file'; uri: string; mime?: string; name?: string };

function parseToolContent(value: unknown): ToolContent[] {
  if (!Array.isArray(value)) return [];
  const out: ToolContent[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) {
      const bare = asString(entry);
      if (bare) out.push({ type: 'text', text: bare });
      continue;
    }
    if (rec.type === 'file') {
      const uri = pickString(rec, ['uri', 'url', 'path']);
      if (!uri) continue;
      const mime = pickString(rec, ['mime', 'mimeType', 'media_type']);
      const name = pickString(rec, ['name', 'filename']);
      out.push({ type: 'file', uri, ...(mime ? { mime } : {}), ...(name ? { name } : {}) });
      continue;
    }
    const text = asString(rec.text);
    if (text !== undefined) out.push({ type: 'text', text });
  }
  return out;
}

export interface ToolPart {
  type: 'tool';
  id: string;
  name: string;
  /** Derived by the gateway; absent for a tool it does not recognise. */
  title?: string;
  input: unknown;
  output?: unknown;
  content: ToolContent[];
  /** OpenCode's own metadata, verbatim and camelCase. */
  metadata: Record<string, unknown>;
  state: ToolCallState;
  error?: AgentErrorInfo;
  /** The subagent's session, available from its first progress event. */
  child_session_id?: string;
  /** Set when the tool was detached by `POST …/background`. */
  background?: boolean;
  /** The result the reader is seeing is clipped. */
  truncated?: boolean;
  time?: ToolTiming;
}

export type CompactionStatus = 'running' | 'completed' | 'failed';
export type CompactionReason = 'auto' | 'manual';

export function parseCompactionReason(value: unknown): CompactionReason {
  return asString(value) === 'manual' ? 'manual' : 'auto';
}

export function parseCompactionStatus(value: unknown): CompactionStatus | 'started' {
  const raw = asString(value);
  if (raw === 'started') return 'started';
  if (raw === 'completed' || raw === 'failed') return raw;
  return 'running';
}

export type ShellStatus = 'running' | 'exited' | 'timeout' | 'killed';

export function parseShellStatus(value: unknown): ShellStatus {
  const raw = asString(value);
  if (raw === 'exited' || raw === 'timeout' || raw === 'killed') return raw;
  return 'running';
}

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; duration_ms?: number }
  | ToolPart
  | {
      type: 'compaction';
      status: CompactionStatus;
      reason: CompactionReason;
      summary?: string;
      recent?: string;
      tokens?: TokensUsage;
      cost?: number;
      error?: AgentErrorInfo;
    }
  | { type: 'skill'; skill: string; name?: string; text?: string }
  | {
      type: 'shell';
      shell_id: string;
      command: string;
      status: ShellStatus;
      exit?: number;
      output?: string;
      truncated?: boolean;
    }
  | { type: 'model_switched'; model: ModelRef | null; previous: ModelRef | null }
  | { type: 'agent_switched'; agent: string; previous?: string }
  | { type: 'synthetic'; text?: string; description?: string }
  | { type: 'system'; text?: string; description?: string }
  | { type: 'location_switched'; directory: string; previous?: string }
  | { type: 'todo'; items: TodoItem[] }
  | { type: 'diff'; file: string; diff: string }
  | { type: 'approval'; request: PermissionRequest }
  | { type: 'form'; request: FormRequest }
  | { type: 'status'; text: string }
  /**
   * A part kind this build has never heard of.
   *
   * OpenCode grows part types, and a row whose part was dropped took the whole
   * `TimelineItem` with it -- so a newer engine's output had *holes* in it,
   * silently, with the surrounding turn reading as if nothing had happened
   * there. A named placeholder is the honest answer: the reader can see that
   * something was said and that this app cannot say what.
   */
  | { type: 'unsupported'; raw_type: string };

/** The part kinds that are one quiet line rather than a block of content. */
export type AgentNoticePartType =
  | 'model_switched'
  | 'agent_switched'
  | 'location_switched'
  | 'skill'
  | 'synthetic'
  | 'system';

const NOTICE_PART_TYPES: readonly AgentNoticePartType[] = [
  'model_switched',
  'agent_switched',
  'location_switched',
  'skill',
  'synthetic',
  'system',
];

export function isNoticePart(
  part: AgentPart
): part is Extract<AgentPart, { type: AgentNoticePartType }> {
  return (NOTICE_PART_TYPES as readonly string[]).includes(part.type);
}

function parseTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return [];
  const out: TodoItem[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) {
      const bare = asString(entry);
      if (bare) out.push({ text: bare, done: false });
      continue;
    }
    const text = pickString(rec, ['text', 'content', 'title']);
    if (!text) continue;
    out.push({
      text,
      done: rec.done === true || asString(rec.status) === 'completed',
    });
  }
  return out;
}

function parseToolTiming(value: unknown): ToolTiming | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const timing: ToolTiming = {};
  const created = asFiniteNumber(rec.created);
  if (created !== undefined) timing.created = created;
  const ran = asFiniteNumber(rec.ran);
  if (ran !== undefined) timing.ran = ran;
  const completed = asFiniteNumber(rec.completed);
  if (completed !== undefined) timing.completed = completed;
  return timing.created === undefined && timing.ran === undefined && timing.completed === undefined
    ? undefined
    : timing;
}

/** How long a tool ran, in milliseconds, when both ends are known. */
export function toolDurationMs(time: ToolTiming | undefined): number | undefined {
  if (!time || time.ran === undefined || time.completed === undefined) return undefined;
  const elapsed = time.completed - time.ran;
  return elapsed >= 0 ? elapsed : undefined;
}

function parseToolPart(rec: Record<string, unknown>): ToolPart | null {
  const id = pickString(rec, ['id', 'tool_call_id', 'callID', 'call_id']);
  const name = pickString(rec, ['name', 'tool']);
  if (!name) return null;
  const metadata = asRecord(rec.metadata) ?? {};
  const part: ToolPart = {
    type: 'tool',
    id: id ?? name,
    name,
    input: rec.input,
    content: parseToolContent(rec.content),
    metadata,
    // `status` carries the same value under the name the previous release
    // used, so either spelling settles it.
    state: parseToolState(rec.state ?? rec.status),
  };
  const title = pickString(rec, ['title']);
  if (title) part.title = title;
  if (rec.output !== undefined) part.output = rec.output;
  const error = parseAgentError(rec.error);
  if (error) {
    part.error = error;
    part.state = 'failed';
  }
  const childSessionId =
    pickString(rec, ['child_session_id', 'childSessionID']) ??
    pickString(metadata, ['sessionID', 'session_id']);
  if (childSessionId) part.child_session_id = childSessionId;
  // OpenCode 2.0.1 has no flag of its own, so the gateway sets one and reads
  // `metadata.background` in case a later version starts sending it.
  if (rec.background === true || metadata.background === true) part.background = true;
  if (rec.truncated === true || metadata.truncated === true) part.truncated = true;
  const time = parseToolTiming(rec.time);
  if (time) part.time = time;
  return part;
}

export function parseAgentPart(value: unknown): AgentPart | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const type = asString(rec.type);
  if (!type) return null;

  switch (type) {
    case 'text':
      return { type: 'text', text: asString(rec.text) ?? '' };
    case 'reasoning': {
      const durationMs = asFiniteNumber(rec.duration_ms);
      return {
        type: 'reasoning',
        text: asString(rec.text) ?? '',
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      };
    }
    case 'tool':
      return parseToolPart(rec);
    case 'compaction': {
      const status = parseCompactionStatus(rec.status);
      const summary = asString(rec.summary);
      const recent = asString(rec.recent);
      const tokens = parseTokensUsage(rec.tokens);
      const cost = asFiniteNumber(rec.cost);
      const error = parseAgentError(rec.error);
      return {
        type: 'compaction',
        // `started` is an event-only state; a timeline row for it is running.
        status: status === 'started' ? 'running' : status,
        reason: parseCompactionReason(rec.reason),
        ...(summary ? { summary } : {}),
        ...(recent ? { recent } : {}),
        ...(tokens ? { tokens } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(error ? { error } : {}),
      };
    }
    case 'skill': {
      const skill = pickString(rec, ['skill', 'skillID', 'skill_id', 'id']);
      if (!skill) return null;
      const name = pickString(rec, ['name']);
      const text = asString(rec.text);
      return {
        type: 'skill',
        skill,
        ...(name ? { name } : {}),
        ...(text ? { text } : {}),
      };
    }
    case 'shell': {
      const shellId = pickString(rec, ['shell_id', 'shellID', 'id']);
      if (!shellId) return null;
      const exit = asFiniteNumber(rec.exit);
      const output = asString(rec.output);
      return {
        type: 'shell',
        shell_id: shellId,
        command: asString(rec.command) ?? '',
        status: parseShellStatus(rec.status),
        ...(exit !== undefined ? { exit } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(rec.truncated === true ? { truncated: true } : {}),
      };
    }
    case 'model_switched':
      return {
        type: 'model_switched',
        model: parseModelRef(rec.model),
        previous: parseModelRef(rec.previous),
      };
    case 'agent_switched': {
      const agent = pickString(rec, ['agent']);
      if (!agent) return null;
      const previous = pickString(rec, ['previous']);
      return { type: 'agent_switched', agent, ...(previous ? { previous } : {}) };
    }
    case 'synthetic':
    case 'system': {
      const text = asString(rec.text);
      const description = asString(rec.description);
      return {
        type,
        ...(text ? { text } : {}),
        ...(description ? { description } : {}),
      };
    }
    case 'location_switched': {
      const directory = pickString(rec, ['directory']);
      if (!directory) return null;
      const previous = pickString(rec, ['previous']);
      return { type: 'location_switched', directory, ...(previous ? { previous } : {}) };
    }
    case 'todo':
    case 'todos':
      return { type: 'todo', items: parseTodoItems(rec.items ?? rec.todos) };
    case 'diff':
      return {
        type: 'diff',
        file: asString(rec.file) ?? '',
        diff: asString(rec.diff) ?? '',
      };
    case 'approval': {
      const request = parsePermissionRequest(rec.request);
      return request ? { type: 'approval', request } : null;
    }
    case 'form': {
      const request = parseFormRequest(rec.request);
      return request ? { type: 'form', request } : null;
    }
    case 'status':
      return { type: 'status', text: asString(rec.text) ?? '' };
    default:
      // A kind this build does not know. Not a malformed payload -- those
      // still come back `null` above, because a `tool` with no name or an
      // `approval` with no request is broken rather than new.
      return { type: 'unsupported', raw_type: type };
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineRole = 'user' | 'assistant' | 'system';

export function parseTimelineRole(value: unknown): TimelineRole {
  const raw = asString(value);
  return raw === 'user' || raw === 'system' ? raw : 'assistant';
}

export interface TimelineItem {
  id: string;
  message_id: string;
  role: TimelineRole;
  /** The part's position within its message; the second sort key. */
  ordinal: number;
  part: AgentPart;
  seq: number;
  updated_ms: number;
  attachments?: string[];
  /** Client-side only: an optimistic row that has not been acknowledged. */
  queued?: boolean;
}

export function parseTimelineItem(value: unknown): TimelineItem | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = asString(rec.id);
  if (!id) return null;
  const part = parseAgentPart(rec.part);
  if (!part) return null;
  const attachments = asStringArray(rec.attachments);
  return {
    id,
    message_id: asString(rec.message_id) ?? id,
    role: parseTimelineRole(rec.role),
    ordinal: asFiniteNumber(rec.ordinal) ?? 0,
    part,
    seq: asFiniteNumber(rec.seq) ?? 0,
    updated_ms: asFiniteNumber(rec.updated_ms) ?? 0,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function parseTimelineItems(value: unknown): TimelineItem[] {
  if (!Array.isArray(value)) return [];
  const out: TimelineItem[] = [];
  for (const entry of value) {
    const item = parseTimelineItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/**
 * The timeline's own order: `(message_id, ordinal)`, with message ids sorting
 * by creation.
 *
 * Stable, and applied to a copy: sorting the array a render is reading from is
 * how a list gets a row in two places at once. Ids that sort equal keep the
 * order they arrived in, which is what makes a streaming append look like an
 * append rather than a shuffle.
 */
export function sortTimeline(items: readonly TimelineItem[]): TimelineItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.message_id !== b.item.message_id) {
        return a.item.message_id < b.item.message_id ? -1 : 1;
      }
      if (a.item.ordinal !== b.item.ordinal) return a.item.ordinal - b.item.ordinal;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

export interface InboxItem {
  id: string;
  sessionID: string;
  timeCreated?: number;
  type: 'user' | 'synthetic' | 'compaction' | 'move' | 'unknown';
  payload: unknown;
  delivery: 'steer' | 'queue';
}

const INBOX_TYPES: readonly InboxItem['type'][] = ['user', 'synthetic', 'compaction', 'move'];

export function parseInboxItem(value: unknown): InboxItem | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = pickString(rec, ['id']);
  if (!id) return null;
  const rawType = asString(rec.type) ?? '';
  const timeCreated = asFiniteNumber(rec.timeCreated ?? rec.time_created);
  return {
    id,
    sessionID: pickString(rec, ['sessionID', 'session_id', 'asid']) ?? '',
    ...(timeCreated !== undefined ? { timeCreated } : {}),
    type: (INBOX_TYPES as readonly string[]).includes(rawType)
      ? (rawType as InboxItem['type'])
      : 'unknown',
    payload: rec.payload,
    delivery: asString(rec.delivery) === 'queue' ? 'queue' : 'steer',
  };
}

export function parseInboxItems(value: unknown): InboxItem[] {
  const list = Array.isArray(value) ? value : (asRecord(value)?.items as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  const out: InboxItem[] = [];
  for (const entry of list) {
    const item = parseInboxItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/** The one line an inbox item shows: the prompt text it is carrying. */
export function inboxItemText(item: InboxItem): string {
  const payload = asRecord(item.payload);
  if (!payload) return asString(item.payload) ?? '';
  const direct = pickString(payload, ['text', 'prompt', 'message', 'content']);
  if (direct) return direct;
  if (Array.isArray(payload.parts)) {
    for (const entry of payload.parts) {
      const rec = asRecord(entry);
      const text = rec ? asString(rec.text) : undefined;
      if (text) return text;
    }
  }
  return '';
}

export interface AgentSessionSnapshot {
  info: AgentSessionInfo | null;
  timeline: TimelineItem[];
  permissions: PermissionRequest[];
  forms: FormRequest[];
  inbox: InboxItem[];
  seq: number;
}

export function parseAgentSessionSnapshot(value: unknown): AgentSessionSnapshot {
  const rec = asRecord(value) ?? {};
  const permissions: PermissionRequest[] = [];
  if (Array.isArray(rec.permissions)) {
    for (const entry of rec.permissions) {
      const request = parsePermissionRequest(entry);
      if (request) permissions.push(request);
    }
  }
  const forms: FormRequest[] = [];
  if (Array.isArray(rec.forms)) {
    for (const entry of rec.forms) {
      const request = parseFormRequest(entry);
      if (request) forms.push(request);
    }
  }
  return {
    info: parseAgentSessionInfo(rec.info),
    timeline: sortTimeline(parseTimelineItems(rec.timeline)),
    permissions,
    forms,
    inbox: parseInboxItems(rec.inbox),
    seq: asFiniteNumber(rec.seq) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Context, shells, engine, diff
// ---------------------------------------------------------------------------

/** What `GET …/context` answers: everything still in the model's context. */
export interface AgentContextUsage {
  messages: number;
  tokens: TokensUsage | null;
}

export function parseAgentContextUsage(value: unknown): AgentContextUsage {
  const rec = asRecord(value) ?? {};
  return {
    messages: asFiniteNumber(rec.messages) ?? 0,
    tokens: parseTokensUsage(rec.tokens) ?? null,
  };
}

/** Every token still in context, which is what the ring fills against. */
export function contextTokenTotal(tokens: TokensUsage | null | undefined): number {
  if (!tokens) return 0;
  return tokens.input + tokens.output + (tokens.reasoning ?? 0);
}

/** 0…1, or `null` when there is no limit to measure against. */
export function contextFillRatio(
  tokens: TokensUsage | null | undefined,
  limit: number | undefined
): number | null {
  if (!limit || limit <= 0) return null;
  const used = contextTokenTotal(tokens);
  if (used <= 0) return 0;
  return Math.min(1, used / limit);
}

export interface ShellInfo {
  id: string;
  status: ShellStatus;
  command: string;
  cwd?: string;
  shell?: string;
  file?: string;
  pid?: number;
  exit?: number;
  metadata: Record<string, unknown>;
  time?: Record<string, unknown>;
}

export function parseShellInfo(value: unknown): ShellInfo | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = pickString(rec, ['id']);
  if (!id) return null;
  const info: ShellInfo = {
    id,
    status: parseShellStatus(rec.status),
    command: asString(rec.command) ?? '',
    metadata: asRecord(rec.metadata) ?? {},
  };
  const cwd = pickString(rec, ['cwd']);
  if (cwd) info.cwd = cwd;
  const shell = pickString(rec, ['shell']);
  if (shell) info.shell = shell;
  const file = pickString(rec, ['file']);
  if (file) info.file = file;
  const pid = asFiniteNumber(rec.pid);
  if (pid !== undefined) info.pid = pid;
  const exit = asFiniteNumber(rec.exit);
  if (exit !== undefined) info.exit = exit;
  const time = asRecord(rec.time);
  if (time) info.time = time;
  return info;
}

export function parseShellList(value: unknown): ShellInfo[] {
  const list = Array.isArray(value) ? value : (asRecord(value)?.shells as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  const out: ShellInfo[] = [];
  for (const entry of list) {
    const info = parseShellInfo(entry);
    if (info) out.push(info);
  }
  return out;
}

/** One page of a background shell's output, addressed by an opaque cursor. */
export interface ShellOutputPage {
  output: string;
  cursor: number;
  size: number;
  truncated: boolean;
}

export function parseShellOutputPage(value: unknown): ShellOutputPage {
  const rec = asRecord(value) ?? {};
  return {
    output: asString(rec.output) ?? '',
    cursor: asFiniteNumber(rec.cursor) ?? 0,
    size: asFiniteNumber(rec.size) ?? 0,
    truncated: rec.truncated === true,
  };
}

export interface AgentEngineInfo {
  available: boolean;
  origin: 'adopted' | 'spawned' | 'none';
  url?: string;
  version?: string;
  stream_connected: boolean;
  autostart: boolean;
}

export function parseAgentEngineInfo(value: unknown): AgentEngineInfo {
  const rec = asRecord(value) ?? {};
  const origin = asString(rec.origin);
  const url = pickString(rec, ['url']);
  const version = pickString(rec, ['version']);
  return {
    available: rec.available === true,
    origin: origin === 'adopted' || origin === 'spawned' ? origin : 'none',
    ...(url ? { url } : {}),
    ...(version ? { version } : {}),
    stream_connected: rec.stream_connected === true,
    autostart: rec.autostart !== false,
  };
}

/** One file's unified patch, as `…/vcs/diff` and `edit`'s metadata both give it. */
export interface FileDiffItem {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export function parseFileDiffItem(value: unknown): FileDiffItem | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const path = pickString(rec, ['path', 'file', 'filename', 'filePath', 'file_path']);
  if (!path) return null;
  return {
    path,
    patch: asString(rec.patch) ?? asString(rec.diff) ?? '',
    additions: asFiniteNumber(rec.additions) ?? asFiniteNumber(rec.added) ?? 0,
    deletions: asFiniteNumber(rec.deletions) ?? asFiniteNumber(rec.removed) ?? 0,
  };
}

export function parseFileDiffItems(value: unknown): FileDiffItem[] {
  const list = Array.isArray(value)
    ? value
    : ((asRecord(value)?.diff ?? asRecord(value)?.files) as unknown[] | undefined);
  if (!Array.isArray(list)) return [];
  const out: FileDiffItem[] = [];
  for (const entry of list) {
    const item = parseFileDiffItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/** Which comparison `…/vcs/diff` is asked for; OpenCode requires one. */
export type VcsDiffMode = 'working' | 'branch' | 'committed';

export const VCS_DIFF_MODES: readonly VcsDiffMode[] = ['working', 'branch', 'committed'];

export function parseVcsDiffMode(value: unknown): VcsDiffMode {
  const raw = asString(value);
  return raw === 'branch' || raw === 'committed' ? raw : 'working';
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface ModelVariantInfo {
  id: string;
  reasoning_effort?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider_id: string;
  family?: string;
  limit?: ContextLimit;
  variants?: ModelVariantInfo[];
  cost?: unknown;
  /** Carried through rather than filtered: grey it out and say why. */
  enabled: boolean;
  status?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  activation?: 'auto' | 'enabled' | 'disabled';
  models: ModelInfo[];
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode?: string;
  color?: string;
  /**
   * A picker hides these. Optional because the app ships a hard-coded
   * fallback list for a gateway that answered with no catalog at all, and
   * "absent" and "false" mean the same thing here.
   */
  hidden?: boolean;
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

export interface CommandInfo {
  name: string;
  description?: string;
  agent?: string;
  template?: string;
}

export interface CatalogDefaults {
  model?: ModelRef;
  agent?: string;
}

export interface AgentCatalog {
  models: ModelInfo[];
  agents: AgentInfo[];
  mcp: McpServerInfo[];
  skills: SkillInfo[];
  providers: ProviderInfo[];
  commands: CommandInfo[];
  defaults: CatalogDefaults;
}

export const EMPTY_CATALOG: AgentCatalog = Object.freeze({
  models: Object.freeze([]) as unknown as ModelInfo[],
  agents: Object.freeze([]) as unknown as AgentInfo[],
  mcp: Object.freeze([]) as unknown as McpServerInfo[],
  skills: Object.freeze([]) as unknown as SkillInfo[],
  providers: Object.freeze([]) as unknown as ProviderInfo[],
  commands: Object.freeze([]) as unknown as CommandInfo[],
  defaults: Object.freeze({}) as CatalogDefaults,
});

function parseModelVariants(value: unknown): ModelVariantInfo[] {
  if (!Array.isArray(value)) return [];
  const out: ModelVariantInfo[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) {
      const bare = asString(entry);
      if (bare) out.push({ id: bare });
      continue;
    }
    const id = pickString(rec, ['id']);
    if (!id) continue;
    const effort = pickString(rec, ['reasoning_effort', 'reasoningEffort']);
    out.push({ id, ...(effort ? { reasoning_effort: effort } : {}) });
  }
  return out;
}

export function parseModelInfo(value: unknown, providerId?: string): ModelInfo | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const id = pickString(rec, ['id']);
  if (!id) return null;
  const provider = pickString(rec, ['provider_id', 'providerID']) ?? providerId;
  if (!provider) return null;
  const model: ModelInfo = {
    id,
    name: pickString(rec, ['name']) ?? id,
    provider_id: provider,
    enabled: rec.enabled !== false,
  };
  const family = pickString(rec, ['family']);
  if (family) model.family = family;
  const limit = parseContextLimit(rec.limit);
  if (limit) model.limit = limit;
  const variants = parseModelVariants(rec.variants);
  if (variants.length > 0) model.variants = variants;
  if (rec.cost !== undefined) model.cost = rec.cost;
  const status = pickString(rec, ['status']);
  if (status) model.status = status;
  return model;
}

export function parseAgentCatalog(value: unknown): AgentCatalog {
  const rec = asRecord(value) ?? {};

  const models: ModelInfo[] = [];
  if (Array.isArray(rec.models)) {
    for (const entry of rec.models) {
      const model = parseModelInfo(entry);
      if (model) models.push(model);
    }
  }

  const providers: ProviderInfo[] = [];
  if (Array.isArray(rec.providers)) {
    for (const entry of rec.providers) {
      const providerRec = asRecord(entry);
      if (!providerRec) continue;
      const id = pickString(providerRec, ['id']);
      if (!id) continue;
      const activation = asString(providerRec.activation);
      const providerModels: ModelInfo[] = [];
      if (Array.isArray(providerRec.models)) {
        for (const modelEntry of providerRec.models) {
          const model = parseModelInfo(modelEntry, id);
          if (model) providerModels.push(model);
        }
      }
      providers.push({
        id,
        name: pickString(providerRec, ['name']) ?? id,
        ...(activation === 'auto' || activation === 'enabled' || activation === 'disabled'
          ? { activation }
          : {}),
        models: providerModels,
      });
      // The flat list is what every picker in the app reads; a provider-only
      // catalog must not come back with no models at all.
      for (const model of providerModels) {
        if (
          !models.some((known) => known.id === model.id && known.provider_id === model.provider_id)
        ) {
          models.push(model);
        }
      }
    }
  }

  const agents: AgentInfo[] = [];
  if (Array.isArray(rec.agents)) {
    for (const entry of rec.agents) {
      const agentRec = asRecord(entry);
      if (!agentRec) continue;
      const id = pickString(agentRec, ['id']);
      if (!id) continue;
      const description = pickString(agentRec, ['description']);
      const mode = pickString(agentRec, ['mode']);
      const color = pickString(agentRec, ['color']);
      agents.push({
        id,
        name: pickString(agentRec, ['name']) ?? id,
        ...(description ? { description } : {}),
        ...(mode ? { mode } : {}),
        ...(color ? { color } : {}),
        hidden: agentRec.hidden === true,
      });
    }
  }

  const mcp: McpServerInfo[] = [];
  if (Array.isArray(rec.mcp)) {
    for (const entry of rec.mcp) {
      const mcpRec = asRecord(entry);
      if (!mcpRec) continue;
      const name = pickString(mcpRec, ['name']);
      if (!name) continue;
      const error = pickString(mcpRec, ['error']);
      mcp.push({
        name,
        status: asString(mcpRec.status) ?? 'unknown',
        ...(error ? { error } : {}),
      });
    }
  }

  const skills: SkillInfo[] = [];
  if (Array.isArray(rec.skills)) {
    for (const entry of rec.skills) {
      const skillRec = asRecord(entry);
      if (!skillRec) continue;
      const id = pickString(skillRec, ['id']);
      if (!id) continue;
      skills.push({
        id,
        name: pickString(skillRec, ['name']) ?? id,
        description: asString(skillRec.description) ?? '',
      });
    }
  }

  const commands: CommandInfo[] = [];
  if (Array.isArray(rec.commands)) {
    for (const entry of rec.commands) {
      const commandRec = asRecord(entry);
      if (!commandRec) continue;
      const name = pickString(commandRec, ['name']);
      if (!name) continue;
      const description = pickString(commandRec, ['description']);
      const agent = pickString(commandRec, ['agent']);
      const template = pickString(commandRec, ['template']);
      commands.push({
        name,
        ...(description ? { description } : {}),
        ...(agent ? { agent } : {}),
        ...(template ? { template } : {}),
      });
    }
  }

  const defaultsRec = asRecord(rec.defaults) ?? {};
  const defaultModel = parseModelRef(defaultsRec.model);
  const defaultAgent = pickString(defaultsRec, ['agent']);

  return {
    models,
    agents,
    mcp,
    skills,
    providers,
    commands,
    defaults: {
      ...(defaultModel ? { model: defaultModel } : {}),
      ...(defaultAgent ? { agent: defaultAgent } : {}),
    },
  };
}

/** A picker hides hidden agents and subagent-mode entries. */
export function selectableAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((agent) => !agent.hidden && agent.mode !== 'subagent');
}

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

export type AgentDomainEvent =
  | { type: 'agent.session.updated'; asid: string; seq: number; info: AgentSessionInfo }
  | {
      type: 'agent.status.changed';
      asid: string;
      seq: number;
      status: AgentRunStatus;
      error?: AgentErrorInfo;
    }
  | { type: 'agent.timeline.upsert'; asid: string; seq: number; items: TimelineItem[] }
  | { type: 'agent.timeline.removed'; asid: string; seq: number; ids: string[] }
  | { type: 'agent.permission.pending'; asid: string; seq: number; request: PermissionRequest }
  | { type: 'agent.permission.resolved'; asid: string; seq: number; request_id: string }
  | { type: 'agent.form.pending'; asid: string; seq: number; request: FormRequest }
  | { type: 'agent.form.resolved'; asid: string; seq: number; form_id: string }
  | {
      type: 'agent.compaction.changed';
      asid: string;
      seq: number;
      status: CompactionStatus | 'started';
      reason: CompactionReason;
      delta?: string;
    }
  | { type: 'agent.inbox.changed'; asid: string; seq: number; items: InboxItem[] }
  | { type: 'agent.resync'; asid: string; seq: number; reason?: string };

/**
 * One SSE frame, as an event this app understands, or `null`.
 *
 * The SSE `event:` name and the payload's own `type` are the same string, and
 * either may be the one that arrived: a frame with no `event:` name still
 * carries its type inside. `asid` and `session_id` are both accepted for the
 * same field, which is what the contract says about the two newer events.
 */
export function parseAgentDomainEvent(eventName: string, data: unknown): AgentDomainEvent | null {
  // Every documented event carries an object. A frame whose payload is not one
  // -- a body that did not parse as JSON, a keep-alive that grew a comment --
  // is not a domain event, and treating it as one used to synthesise an
  // `agent.status.changed` with an empty `asid` and a status of `unknown`:
  // a malformed frame flipping the open session's state.
  const rec = asRecord(data);
  if (!rec) return null;
  const type = asString(rec.type) ?? eventName;
  const asid = pickString(rec, ['asid', 'session_id', 'sessionID']) ?? '';
  const seq = asFiniteNumber(rec.seq) ?? 0;

  switch (type) {
    case 'agent.session.updated': {
      const info = parseAgentSessionInfo(rec.info ?? rec.update ?? rec.session);
      return info ? { type, asid: asid || info.asid, seq, info } : null;
    }
    case 'agent.status.changed': {
      const error = parseAgentError(rec.error);
      return {
        type,
        asid,
        seq,
        status: parseRunStatus(rec.status),
        ...(error ? { error } : {}),
      };
    }
    case 'agent.timeline.upsert': {
      const items = parseTimelineItems(
        Array.isArray(rec.items) ? rec.items : rec.item !== undefined ? [rec.item] : []
      );
      return items.length > 0 ? { type, asid, seq, items } : null;
    }
    case 'agent.timeline.removed': {
      const ids = asStringArray(rec.ids);
      return ids.length > 0 ? { type, asid, seq, ids } : null;
    }
    case 'agent.permission.pending': {
      const request = parsePermissionRequest(rec.request);
      return request ? { type, asid, seq, request } : null;
    }
    case 'agent.permission.resolved': {
      const requestId = pickString(rec, ['request_id', 'requestID', 'id']);
      return requestId ? { type, asid, seq, request_id: requestId } : null;
    }
    case 'agent.form.pending': {
      const request = parseFormRequest(rec.request);
      return request ? { type, asid, seq, request } : null;
    }
    case 'agent.form.resolved': {
      const formId = pickString(rec, ['form_id', 'formID', 'id']);
      return formId ? { type, asid, seq, form_id: formId } : null;
    }
    case 'agent.compaction.changed': {
      const delta = asString(rec.delta);
      return {
        type,
        asid,
        seq,
        status: parseCompactionStatus(rec.status),
        reason: parseCompactionReason(rec.reason),
        ...(delta ? { delta } : {}),
      };
    }
    case 'agent.inbox.changed':
      return { type, asid, seq, items: parseInboxItems(rec.items) };
    case 'agent.resync': {
      const reason = pickString(rec, ['reason']);
      return { type, asid, seq, ...(reason ? { reason } : {}) };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers with no UI in them
// ---------------------------------------------------------------------------

/**
 * Whether a session has a real title, or is still waiting for the auto-title
 * that lands on its first turn.
 *
 * A raw `ses_…` id is not a title. It is the one string the strip, the header
 * and the sessions list must never show, and the check belongs here rather
 * than in each of the three places that ask.
 */
export function hasRealSessionTitle(
  session:
    | {
        title?: string;
        asid?: string;
      }
    | undefined
    | null
): boolean {
  const raw = session?.title?.trim();
  if (!raw) return false;
  if (session?.asid && raw === session.asid) return false;
  return !/^ses_[A-Za-z0-9]+$/.test(raw);
}

/** A session's title, or `fallback` while it is still untitled. */
export function sessionTitleOr(
  session: { title?: string; asid?: string } | undefined | null,
  fallback: string
): string {
  return hasRealSessionTitle(session) ? (session?.title ?? fallback).trim() : fallback;
}

/** Whether a catalog model sits on the free tier. */
export function isFreeModel(model: { id: string; name?: string; provider_id: string }): boolean {
  const idLower = (model.id || '').toLowerCase();
  const nameLower = (model.name || '').toLowerCase();
  const provLower = (model.provider_id || '').toLowerCase();
  return (
    idLower.includes('free') ||
    nameLower.includes('free') ||
    provLower === 'opencode' ||
    provLower.includes('free')
  );
}

const KNOWN_MODEL_NAMES: Readonly<Record<string, string>> = {
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-6-astra': 'GPT-6 Astra',
  'gpt-6-astra-fast': 'GPT-6 Astra Fast',
  'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning',
  'ling-3.0-flash-fin-free': 'Ling 3.0 Flash',
};

export function formatModelName(model?: ModelRef | null, fallback = 'Model'): string {
  if (!model?.model_id) return fallback;
  const modelId = model.model_id;
  const baseName =
    KNOWN_MODEL_NAMES[modelId] ||
    modelId
      .split(/[-_]/)
      .map((word) =>
        word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)
      )
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
