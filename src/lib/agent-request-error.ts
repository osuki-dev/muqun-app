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
 * `<what>: <status> <body>` (agent-session), `HTTP <status>: <body>`
 * (gateway-client) or `<what> (<status>)`.
 */
const STATUS_PATTERN = /^(?:HTTP (\d{3}):|[^{]*?:\s(\d{3})(?:\s|$)|[^{]*\((\d{3})\)$)/;

function readBody(raw: string): { code?: string; message?: string } {
  const start = raw.indexOf('{');
  if (start < 0) return {};
  try {
    const parsed = JSON.parse(raw.slice(start)) as unknown;
    const error = (parsed as { error?: unknown } | null)?.error;
    if (error && typeof error === 'object') {
      const { code, message } = error as { code?: unknown; message?: unknown };
      return {
        code: typeof code === 'string' ? code : undefined,
        message: typeof message === 'string' ? message : undefined,
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
} {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const match = raw.match(STATUS_PATTERN);
  const status = Number(match?.[1] ?? match?.[2] ?? match?.[3] ?? 0);
  return { raw, match, status, ...readBody(raw) };
}

export function classifyAgentRequestError(err: unknown): AgentRequestError {
  const { raw, match, status, code, message } = readAgentRequestError(err);

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
  if (!status) {
    const lower = raw.toLowerCase();
    if (NO_RESPONSE.some((needle) => lower.includes(needle))) return { kind: 'offline' };
  }
  return { kind: 'other', message: raw };
}

/** Whether a failed read should put the screen into its offline state. */
export function isAgentOfflineError(err: unknown): boolean {
  return classifyAgentRequestError(err).kind === 'offline';
}
