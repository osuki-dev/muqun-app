/**
 * Which backend session the workspace is reading, and how the reader gets to
 * say so.
 *
 * A gateway can expose more than one session -- a tmux socket, a second tmux
 * socket, a Herdr instance -- and until now the app simply opened whichever one
 * `GET /api/sessions` led with. That order is the gateway's own and it is not a
 * preference: `backend default` reorders the list, but liveness outranks it, so
 * a machine whose second backend happens to be busier hands the reader a
 * different session from one visit to the next.
 *
 * Everything here is pure so the three decisions that matter can be tested
 * without a gateway, a keychain or a renderer: whether the control is drawn at
 * all, what order the choices are in, and where a remembered choice that has
 * since disappeared lands instead.
 */
import type { SessionsResponse } from '@/lib/gateway-client';

/** The default the gateway omits: a session with no `backend` is a Herdr one. */
const DEFAULT_BACKEND_KIND = 'herdr';

/**
 * The session id the workspace falls back to when the gateway names none. The
 * gateway's own single-session installs use this id, and every request path
 * needs *some* id to build a URL from.
 */
export const FALLBACK_SESSION_ID = 'default';

/** One row of the switcher: what it is called, and what it runs on. */
export type SessionChoice = {
  id: string;
  /** Never empty -- a session the gateway did not label is named by its id. */
  label: string;
  /** `herdr`, `tmux`, or whatever a newer gateway grows. */
  kind: string;
};

/**
 * The gateway's list, cleaned up but *not* reordered.
 *
 * The order is deliberately left alone. It is the gateway's answer to which
 * backend is live and which one its owner made default, and re-sorting it here
 * would put the app's opinion on top of a decision that was made on the machine
 * -- while also making the first item, which is what an app with no remembered
 * choice opens, disagree with what every other client sees.
 */
export function sessionChoices(sessions: SessionsResponse['sessions']): SessionChoice[] {
  return normalizeChoices(sessions);
}

/**
 * The same list, read back from a route param.
 *
 * The switcher sheet is a route, so what it lists has to reach it as a string.
 * It is handed the list the header already had rather than fetching its own:
 * the header decided there was something to switch between from that list, and
 * a second read could disagree with it -- and a sheet sized to its contents
 * that grows a row while it is opening is a worse answer than one that is right
 * immediately. A param this cannot read is an empty sheet, never a crash.
 */
export function parseSessionChoices(value: string | undefined): SessionChoice[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeChoices(parsed) : [];
  } catch {
    return [];
  }
}

/** What `parseSessionChoices` reads. */
export function encodeSessionChoices(choices: readonly SessionChoice[]): string {
  return JSON.stringify(choices);
}

/**
 * Whether two readings of the gateway's list say the same thing, so the poller
 * can hand back the array it already had and leave the header's memo alone.
 */
export function sameSessionChoices(
  current: readonly SessionChoice[],
  next: readonly SessionChoice[]
): boolean {
  return encodeSessionChoices(current) === encodeSessionChoices(next);
}

function normalizeChoices(sessions: readonly unknown[] | undefined): SessionChoice[] {
  const seen = new Set<string>();
  const choices: SessionChoice[] = [];
  for (const session of sessions ?? []) {
    if (typeof session !== 'object' || session === null) continue;
    const { id, label, backend, kind } = session as Record<string, unknown>;
    const sessionId = typeof id === 'string' ? id.trim() : '';
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const name = typeof label === 'string' ? label.trim() : '';
    // `backend` is what the gateway calls it and `kind` is what this module
    // calls it, so one function reads both the wire shape and its own.
    const backendKind = typeof backend === 'string' ? backend.trim() : '';
    const encodedKind = typeof kind === 'string' ? kind.trim() : '';
    choices.push({
      id: sessionId,
      label: name || sessionId,
      kind: backendKind || encodedKind || DEFAULT_BACKEND_KIND,
    });
  }
  return choices;
}

/**
 * Whether the workspace draws the switcher at all.
 *
 * One session is the overwhelmingly common case and it has nothing to switch
 * between, so the header must look exactly as it did before this feature
 * existed -- no icon, no chip, no reserved width. That is a rule about a number
 * rather than a rendering detail, which is why it lives here and is tested,
 * instead of being an `&&` inside the header's JSX where the next change to the
 * row can quietly turn it into "sometimes".
 */
export function shouldShowSessionSwitcher(choices: readonly SessionChoice[]): boolean {
  return choices.length > 1;
}

/**
 * The session the workspace should actually open.
 *
 * `preferred` is what the reader asked for -- a pick they just made, a pane
 * deep link from a push notification, or what they were reading here last time.
 * A preference naming a session this gateway no longer has is not an error: the
 * backend may have been removed, or the record may predate it. It falls through
 * to the gateway's first, which is exactly where the app went before there was
 * anything to remember.
 */
export function resolveSessionId(
  choices: readonly SessionChoice[],
  preferred?: string | null
): string {
  const wanted = preferred?.trim();
  if (wanted) {
    const match = choices.find((choice) => choice.id === wanted);
    if (match) return match.id;
  }
  return choices[0]?.id ?? FALLBACK_SESSION_ID;
}

/** Per-server: the session id this device was last reading on each server. */
export type ServerSessionIndex = Record<string, string>;

export const SERVER_SESSION_STORAGE_KEY = 'muqun.server-session.v1';

/**
 * How many servers keep a remembered session. The same cap, for the same
 * reason, as the last-viewed marks next door: unpaired records are dropped on
 * sight and the cap keeps a long-lived install from carrying ids for machines
 * it will never open again.
 */
export const MAX_REMEMBERED_SERVERS = 24;

/** Anything that is not `{ [serverId]: sessionId }` is read as no memory. */
export function parseServerSessionIndex(value: string): ServerSessionIndex {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const index: ServerSessionIndex = {};
    for (const [serverId, sessionId] of Object.entries(parsed as Record<string, unknown>)) {
      if (!serverId) continue;
      if (typeof sessionId !== 'string' || !sessionId) continue;
      index[serverId] = sessionId;
    }
    return index;
  } catch {
    return {};
  }
}

/**
 * Writes one server's choice, dropping the oldest entries once the index is
 * over the cap. Insertion order is the age order: `Object.entries` preserves
 * it, and rewriting an existing server's choice moves it to the end.
 */
export function rememberServerSession(
  index: ServerSessionIndex,
  serverId: string,
  sessionId: string
): ServerSessionIndex {
  if (!serverId || !sessionId) return index;
  if (index[serverId] === sessionId) return index;
  const entries = Object.entries(index).filter(([id]) => id !== serverId);
  entries.push([serverId, sessionId]);
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_SERVERS));
}
