/**
 * What a failed agent request means for the reader: the agent is not
 * answering, the agent answered and refused, or something else went wrong.
 *
 * The workbench used to read every `502`, `503` and `agent_error` as "the
 * service is offline" and print the start command. A `502 agent_error` is the
 * gateway relaying the agent's own refusal ("Agent session not found: ..."),
 * and telling the reader to start a service that is already running sends
 * them the wrong way. Only `agent_unavailable`, a bare `503`, a gateway that
 * could not reach the agent at all, or a request that never got an answer
 * mean offline.
 *
 * Pure and free of Lingui macros, so the decision is tested here; the sentence
 * is the workbench's, in the agent's own name.
 */

/** Longest stretch of the gateway's own message worth putting in a toast. */
export const AGENT_ERROR_MESSAGE_LIMIT = 200;

export type AgentRequestError =
  | { kind: 'offline' }
  /** The agent answered, and said no; `message` is the gateway's, bounded. */
  | { kind: 'refused'; message: string }
  /** `feature_unsupported` or `501`: this agent cannot do what was asked. */
  | { kind: 'unsupported' }
  /** `invalid_agent`: the gateway does not know the agent the app named. */
  | { kind: 'unknown-agent' }
  /** Anything else, as it was thrown. */
  | { kind: 'other'; message: string };

/**
 * The gateway's own words for "I could not reach the agent", which it relays
 * inside a `502 agent_error` when the agent's process is not listening.
 */
const UNREACHABLE_AGENT = [
  'Connection refused',
  'Network error communicating with agent',
  'error sending request',
];

/** A request that got no answer at all: the transport's words, lowercased. */
const NO_RESPONSE = ['network request failed', 'network error', 'timed out', 'timeout', 'abort'];

/**
 * A native exception relayed as a message: its first line is a Java class
 * name (`java.lang.RuntimeException: Cronet failed: ...`).
 */
const NATIVE_EXCEPTION = /^(?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error)\b/;

/**
 * What makes a native exception a transport failure -- no computer answered --
 * read off its first line: the network stack's own words, never a file or a
 * permission (`FileNotFoundException`, `EACCES`), which say their own thing.
 */
const TRANSPORT_WORDS =
  /network|timeout|timed ?out|connect|socket|unknownhost|cronet|net::err_|sslhandshake/i;

/** A transport error code on the thrown object itself. */
const TRANSPORT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK',
]);

/** Whether a request that got no HTTP status failed in the transport, by the error's shape. */
function transportFailure(err: unknown, raw: string): boolean {
  const shape = (typeof err === 'object' && err !== null ? err : {}) as {
    name?: unknown;
    code?: unknown;
  };
  if (shape.name === 'NetworkError' || shape.name === 'AbortError') return true;
  if (typeof shape.code === 'string' && TRANSPORT_CODES.has(shape.code)) return true;
  const first = raw.trimStart().split(/\r?\n/)[0] ?? '';
  if (NATIVE_EXCEPTION.test(first)) return TRANSPORT_WORDS.test(first);
  const lower = raw.toLowerCase();
  return NO_RESPONSE.some((needle) => lower.includes(needle));
}

/**
 * A message the classifier could not read, made fit for one line under a
 * bar: its first line only -- never a stack trace -- bounded. The whole text
 * goes to the debug log.
 */
function oneLine(raw: string): string {
  // A stack trace starts on its own line; a sentence may say "at foo(" itself.
  const first = raw.trimStart().split(/\r?\n/)[0] ?? '';
  const line = bound(first);
  if (line !== raw.trim()) console.debug('Agent request failed:', raw);
  return line;
}

/**
 * `<what>: <status> <body>` (agent-session), `HTTP <status>: <body>`
 * (gateway-client) or `<what> (<status>)`.
 */
const STATUS_PATTERN = /^(?:HTTP (\d{3}):|[^{]*?:\s(\d{3})(?:\s|$)|[^{]*\((\d{3})\)$)/;

function readBody(raw: string): { code?: string; message?: string; directory?: string } {
  const start = raw.indexOf('{');
  if (start < 0) return {};
  try {
    const parsed = JSON.parse(raw.slice(start)) as unknown;
    const error = (parsed as { error?: unknown } | null)?.error;
    if (error && typeof error === 'object') {
      const { code, message, directory } = error as {
        code?: unknown;
        message?: unknown;
        directory?: unknown;
      };
      return {
        code: typeof code === 'string' ? code : undefined,
        message: typeof message === 'string' ? message : undefined,
        directory: typeof directory === 'string' && directory ? directory : undefined,
      };
    }
  } catch {
    // Not JSON, or cut short: read what the text says instead.
  }
  return {
    code: raw.match(/"code"\s*:\s*"([^"]+)"/)?.[1],
    message: raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1],
  };
}

function bound(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= AGENT_ERROR_MESSAGE_LIMIT) return clean;
  return `${clean.slice(0, AGENT_ERROR_MESSAGE_LIMIT - 1).trimEnd()}…`;
}

/** The HTTP status (0 when none) and the gateway's error code, read off a thrown request error. */
function readAgentRequestError(err: unknown): {
  raw: string;
  match: RegExpMatchArray | null;
  status: number;
  code?: string;
  message?: string;
  directory?: string;
} {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const match = raw.match(STATUS_PATTERN);
  const status = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 0);
  return { raw, match, status, ...readBody(raw) };
}

/**
 * The status, the gateway's error code and its message, for a caller that
 * names its own refusals (`409 listing_truncated`, `404 unknown_path`, ...).
 */
export function agentRequestErrorDetail(err: unknown): {
  status: number;
  code?: string;
  message?: string;
} {
  const { status, code, message } = readAgentRequestError(err);
  return {
    status,
    ...(code ? { code } : {}),
    ...(message ? { message: bound(message) } : {}),
  };
}

/**
 * A session preparation worth sending again: the gateway is still attaching
 * its agents (`503 agent_unavailable` right after a restart) or the network
 * failed outright (resuming with the App). A refusal is final, and so is a
 * timeout: it already spent the whole request budget.
 */
export function isTransientPreparationError(err: unknown): boolean {
  const { raw, status, code } = readAgentRequestError(err);
  if (status) return status === 503 && code === 'agent_unavailable';
  const timedOut =
    (err as { name?: unknown } | null)?.name === 'AbortError' || /time(?:d ?)?out|abort/i.test(raw);
  return !timedOut && transportFailure(err, raw);
}

/** A failed acknowledgement cannot establish that a prompt was rejected. */
export function isAgentDeliveryUnconfirmed(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EACKUNCONFIRMED')
    return true;
  const { raw, status, code, message } = readAgentRequestError(err);
  if (!status) return transportFailure(err, raw);
  if (status === 408 || status === 504) return true;
  // Some providers explicitly report an unknown queue acknowledgement through
  // agent_error. Other 502 agent_error replies can be definite refusals.
  return (
    code === 'agent_error' &&
    /(?:acceptance|delivery|submission|acknowledg(?:e)?ment).*\b(?:unknown|unconfirmed|timed out)\b/i.test(
      message ?? raw
    )
  );
}

export function classifyAgentRequestError(err: unknown): AgentRequestError {
  const { raw, match, status, code, message } = readAgentRequestError(err);

  // No response before the deadline says nothing about the agent's readiness.
  // Keep the timeout visible without switching the workbench to setup mode.
  const errorCode = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
  if (!status && (/timed\s*out|timeout/i.test(raw) || errorCode === 'ETIMEDOUT'))
    return { kind: 'other', message: oneLine(raw) };

  // Both are answers about the request, not about whether the agent is up:
  // checked first, so neither reads as "offline" or as a generic refusal.
  if (code === 'feature_unsupported' || (status === 501 && !code)) return { kind: 'unsupported' };
  if (code === 'invalid_agent') return { kind: 'unknown-agent' };

  if (code === 'agent_unavailable') return { kind: 'offline' };
  if (UNREACHABLE_AGENT.some((needle) => raw.includes(needle))) return { kind: 'offline' };
  if (status === 503 && !code) return { kind: 'offline' };
  if (code === 'agent_error' || status === 502) {
    const said = message ?? (match ? raw.slice(match[0].length) : raw);
    return said.trim() ? { kind: 'refused', message: bound(said) } : { kind: 'offline' };
  }
  if (!status && transportFailure(err, raw)) return { kind: 'offline' };
  // The gateway's own sentence where it sent one, not the JSON it came in.
  return { kind: 'other', message: oneLine(message ?? raw) };
}

/**
 * Whether a pane read failed because the pane no longer exists: the gateway's
 * `404 backend_target_not_found` (the backend has no such pane) or
 * `404 unknown_pane`. An answer about the pane, never worth asking again.
 */
export function paneGoneError(err: unknown): boolean {
  const { status, code } = readAgentRequestError(err);
  return status === 404 && (code === 'backend_target_not_found' || code === 'unknown_pane');
}

/** Whether a failed read should put the screen into its offline state. */
export function isAgentOfflineError(err: unknown): boolean {
  return classifyAgentRequestError(err).kind === 'offline';
}

/**
 * Why a session could not be opened because it is no longer there.
 *
 * `workspace-missing` is the gateway's `404 workspace_missing`: the folder the
 * session stood on was deleted, and `directory` is the path it named when it
 * said so. `session-not-found` is the session itself being unknown, either the
 * gateway's `404 session_not_found` or the agent's own refusal relayed as
 * `agent_error` ("Agent session not found: ..."). Anything else is a session
 * that exists and could not be read, which is not this function's business.
 */
export type AgentSessionGone =
  | { kind: 'workspace-missing'; directory?: string }
  | { kind: 'session-not-found' };

export function classifyAgentSessionGone(err: unknown): AgentSessionGone | null {
  const { status, code, message, directory } = readAgentRequestError(err);
  if (code === 'workspace_missing') {
    return { kind: 'workspace-missing', ...(directory ? { directory } : {}) };
  }
  if (code === 'session_not_found') return { kind: 'session-not-found' };
  if (status === 404 && !code) return { kind: 'session-not-found' };
  if (code === 'agent_error' && /session not found/i.test(message ?? '')) {
    return { kind: 'session-not-found' };
  }
  return null;
}
