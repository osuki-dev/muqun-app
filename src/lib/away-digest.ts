import { asAgentStatus, type AgentStatus } from '@/lib/herdr-entity';

/**
 * "While you were away" (card #691): what the server screen has to say to
 * someone coming back to a machine they last looked at half an hour ago.
 *
 * The gateway keeps a small in-memory ring of agent status transitions and
 * hands back the ones after a timestamp. That is a raw log -- forty lines of
 * `working -> blocked -> working` for one pane is normal -- and a raw log is
 * exactly the wrong thing to put in front of someone who just reopened the app.
 * So the rules here exist to turn it into a sentence: which agents moved, where
 * each of them ended up, and how much of it was worth interrupting for.
 *
 * Three decisions are worth spelling out, because each of them is the
 * difference between a quiet card and a noisy one:
 *
 * 1. **Where an agent ended up beats what it did on the way.** A pane that went
 *    blocked, was answered, and finished is reported as *finished*. The digest
 *    answers "what is the state of my machine now that I am back", not "replay
 *    the last forty minutes". The one exception is the blocked *count*, kept
 *    because "it stopped to ask twice" is a fact about how the work went that
 *    the final status cannot carry.
 *
 * 2. **The pane is the identity, the name is only a label.** Grouping by agent
 *    name would split one pane across a rename and merge two panes running the
 *    same agent binary. Rows are keyed by pane and labelled with the most
 *    recent name that pane was seen under.
 *
 * 3. **Nothing to say means no card.** Every function here can answer "there is
 *    no digest", and the screen draws nothing rather than an empty shell. A
 *    surface that appears to announce that nothing happened is worse than one
 *    that never appears.
 *
 * Deliberately free of React, of the gateway transport, and of Lingui macros:
 * `bun test` transpiles with Bun rather than Babel and never expands a macro,
 * so a module with a real test suite cannot hold one (see `src/i18n/labels.ts`
 * for where the wording lives instead). This module decides *what* is true; the
 * card says it out loud.
 */

/** The gateway capability that gates every part of this feature. */
export const AGENT_EVENTS_CAPABILITY = 'agent_events';

/**
 * A gateway that predates the ring never gets asked for one. The endpoint also
 * degrades to an empty list on 404, but the capability is what keeps the app
 * from making the request at all -- and, more importantly, what keeps the
 * feature *invisible* rather than merely silent on an older server.
 */
export function gatewaySupportsAgentEvents(
  capabilities: readonly string[] | undefined | null
): boolean {
  return Array.isArray(capabilities) && capabilities.includes(AGENT_EVENTS_CAPABILITY);
}

/**
 * How long away is "away".
 *
 * Fifteen minutes, which is roughly the point where a developer stops holding
 * the state of the machine in their head. Below it the digest would be
 * recapping something the user watched happen -- switching apps to answer a
 * message and coming back must not raise a card -- and much above it the
 * feature stops firing on the lunch break it exists for.
 */
export const AWAY_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * How deep the gateway's ring is. Not enforced here -- the gateway does its own
 * capping -- but stated so the summariser's cost is bounded by something known,
 * and so a response that is wildly larger than this is visibly wrong.
 */
export const MAX_AGENT_EVENTS = 200;

/**
 * How many agents get a row of their own.
 *
 * Four, because this is a card floating over a terminal, not a screen. A
 * machine that had nine agents moving is described as "four of them, and five
 * others" -- the count is the useful part past that point, and a card tall
 * enough to list nine would be covering the thing the user came back to look
 * at.
 */
export const MAX_DIGEST_ROWS = 4;

/** Names come off the wire and land in a fixed-width row. */
const MAX_AGENT_NAME_LENGTH = 32;

/** One status transition, as the gateway's ring records it. */
export interface AgentEvent {
  /** The pane the agent runs in. The row's identity; may be empty. */
  paneId: string;
  /** What the agent is called. The row's label; may be empty. */
  agent: string;
  from: AgentStatus;
  to: AgentStatus;
  /** Unix milliseconds. */
  atMs: number;
}


/** One agent's line in the digest. */
export interface AwayDigestRow {
  /** Stable across a re-summarise, so the row does not remount under a fade. */
  key: string;
  agent: string;
  paneId: string;
  /** Where it ended up: the `to` of its most recent transition. */
  status: AgentStatus;
  /** How many times it stopped to ask something while nobody was watching. */
  blocked: number;
  /** It reached `done` at least once, even if it has since moved on. */
  finished: boolean;
  /** Every transition this agent made in the window. */
  transitions: number;
  /** When it last moved. */
  atMs: number;
}

/** Everything the card needs, or `null` where there is no card to draw. */
export interface AwayDigest {
  /** The moment the user last had this server on screen. */
  sinceMs: number;
  /** The moment they came back. */
  untilMs: number;
  /** Every transition the window held, including ones no row shows. */
  transitions: number;
  /** Most recent first, capped at `MAX_DIGEST_ROWS`. */
  rows: AwayDigestRow[];
  /** Agents past the cap: counted rather than listed. */
  otherAgents: number;
}

/**
 * Whether coming back to this server is worth a digest at all.
 *
 * A server never viewed before answers `false` rather than `true`: there is no
 * "away" to summarise, and asking the gateway for everything since the epoch
 * would hand back the whole ring and describe it as news.
 */
export function wasAwayLongEnough(
  lastViewedAtMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (typeof lastViewedAtMs !== 'number' || !Number.isFinite(lastViewedAtMs)) return false;
  if (lastViewedAtMs <= 0) return false;
  // A mark in the future is a clock that moved, not a visit that has not
  // happened yet. Treated as "not away", because the alternative is a card
  // built from a window of unknown length.
  if (lastViewedAtMs > nowMs) return false;
  return nowMs - lastViewedAtMs >= AWAY_THRESHOLD_MS;
}

/**
 * The wire shape, which is untrusted input like every other response: a build
 * of the gateway older or newer than this one may say it differently, and a
 * half-parsed event would render as a row full of `undefined`.
 *
 * Anything unrecognised is dropped rather than defaulted into existence -- an
 * event with no timestamp cannot be ordered, and an event with neither a pane
 * nor an agent cannot be grouped or labelled, so neither is an event.
 *
 * The timestamp is read from `unix_ms`, which is what the ring calls it, and
 * from `at` where that is absent. Both, because the endpoint was specified with
 * `at` and shipped with `unix_ms`, and a client that understands one of them
 * silently shows an empty digest against a gateway that speaks the other --
 * there is no error to notice, just a feature that never appears.
 *
 * `from` is genuinely optional on the wire: the ring leaves it out for the
 * first thing it ever saw a pane do. That reads as `unknown -> working`, which
 * is a transition and belongs in the digest.
 */
export function agentEventsFromResponse(value: unknown): AgentEvent[] {
  if (typeof value !== 'object' || value === null) return [];
  const events = (value as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];

  return events.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const atMs = typeof record.unix_ms === 'number' ? record.unix_ms : record.at;
    if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return [];

    const paneId = typeof record.pane_id === 'string' ? record.pane_id : '';
    const agent = typeof record.agent === 'string' ? record.agent.trim() : '';
    if (!paneId && !agent) return [];

    return [{
      paneId,
      agent: agent.slice(0, MAX_AGENT_NAME_LENGTH),
      // A gateway that only reports where a pane arrived leaves `from` out, and
      // "unknown -> done" is still a transition worth reporting.
      from: asAgentStatus(typeof record.from === 'string' ? record.from : undefined),
      to: asAgentStatus(typeof record.to === 'string' ? record.to : undefined),
      atMs,
    }];
  });
}

export interface SummariseAwayOptions {
  /** The window's start: the last time this server was on screen. */
  sinceMs: number;
  /** The window's end. */
  nowMs?: number;
}

/**
 * The digest, or `null` when there is nothing worth a card.
 *
 * The window is re-applied here rather than trusted from the request. The
 * `since` parameter is the gateway's filter and the gateway's ring may be
 * shorter than the window asked for, but a response is still a list of events
 * with timestamps on them, and a card headed "while you were away" must not
 * include something that happened while the user was watching.
 */
export function summariseAwayEvents(
  events: readonly AgentEvent[],
  { sinceMs, nowMs = Date.now() }: SummariseAwayOptions
): AwayDigest | null {
  const byKey = new Map<string, AwayDigestRow>();
  let transitions = 0;

  for (const event of events) {
    if (!Number.isFinite(event.atMs) || event.atMs <= sinceMs) continue;
    // A status "changing" to itself is a heartbeat the ring happened to record,
    // not news. Counting it would inflate every row's transition count and,
    // worse, make a pane that sat still for an hour look busy.
    if (event.from === event.to) continue;

    const key = event.paneId || `agent:${event.agent}`;
    transitions += 1;
    const existing = byKey.get(key);
    // Events arrive oldest-first from the ring, but nothing in the contract
    // promises it, so "most recent" is decided by comparing timestamps rather
    // than by trusting the order.
    const newest = !existing || event.atMs >= existing.atMs;

    byKey.set(key, {
      key,
      // The latest name the pane was seen under: a rename mid-window should
      // leave one row called by its new name, not two rows.
      agent: newest ? event.agent || existing?.agent || '' : existing?.agent || event.agent,
      paneId: event.paneId || existing?.paneId || '',
      status: newest ? event.to : (existing?.status ?? event.to),
      blocked: (existing?.blocked ?? 0) + (event.to === 'blocked' ? 1 : 0),
      finished: (existing?.finished ?? false) || event.to === 'done',
      transitions: (existing?.transitions ?? 0) + 1,
      atMs: newest ? event.atMs : (existing?.atMs ?? event.atMs),
    });
  }

  if (byKey.size === 0) return null;

  const ordered = [...byKey.values()].sort((a, b) => {
    if (b.atMs !== a.atMs) return b.atMs - a.atMs;
    // Two agents that moved on the same millisecond still have to come out in
    // one order, or the card reshuffles between renders of the same data.
    return a.key.localeCompare(b.key);
  });

  return {
    sinceMs,
    untilMs: nowMs,
    transitions,
    rows: ordered.slice(0, MAX_DIGEST_ROWS),
    otherAgents: Math.max(0, ordered.length - MAX_DIGEST_ROWS),
  };
}

/**
 * How long the user was gone, as a bucket and a count, so the card can say it
 * in the active locale. The same split as `serverAgentsAgeParts`, and for the
 * same reason: a unit letter dropped into a hole is English's abbreviation, and
 * a translator needs the whole sentence.
 *
 * Never `now`: nothing shorter than `AWAY_THRESHOLD_MS` reaches a digest, so
 * the smallest honest bucket is minutes.
 */
export function awayDurationParts(
  digest: Pick<AwayDigest, 'sinceMs' | 'untilMs'>
): { unit: 'minute' | 'hour' | 'day'; value: number } {
  const seconds = Math.max(0, Math.round((digest.untilMs - digest.sinceMs) / 1000));
  if (seconds < 3600) return { unit: 'minute', value: Math.max(1, Math.floor(seconds / 60)) };
  if (seconds < 86400) return { unit: 'hour', value: Math.floor(seconds / 3600) };
  return { unit: 'day', value: Math.floor(seconds / 86400) };
}

// ---------------------------------------------------------------------------
// When each server was last on screen.
//
// Persisted per server, the same shape the agent mirror uses (`server-agents`):
// a small index keyed by local record id, parsed defensively on the way in,
// pruned against the records the device still has. Kept here rather than in a
// module of its own because the threshold that reads a mark and the mark itself
// are one rule -- "have you been away long enough" is unanswerable without both.
// ---------------------------------------------------------------------------

/** Unix milliseconds, keyed by the local record id the route uses. */
export type ServerLastViewedIndex = Record<string, number>;

export const SERVER_LAST_VIEWED_STORAGE_KEY = 'muqun.server-last-viewed.v1';

/**
 * How many servers keep a mark. Unpaired records are pruned on sight, but a cap
 * keeps a long-lived install from accumulating timestamps for machines it will
 * never open again. The same number the agent mirror uses, for the same reason.
 */
export const MAX_TRACKED_SERVERS = 24;

export function parseServerLastViewedIndex(value: string): ServerLastViewedIndex {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const index: ServerLastViewedIndex = {};
    for (const [serverId, atMs] of Object.entries(parsed as Record<string, unknown>)) {
      if (!serverId) continue;
      if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs <= 0) continue;
      index[serverId] = atMs;
    }
    return index;
  } catch {
    return {};
  }
}

/**
 * Drops marks for servers this device no longer has, then caps what is left to
 * the most recently viewed.
 */
export function keepRecentlyViewedServers(
  index: ServerLastViewedIndex,
  serverIds: readonly string[]
): ServerLastViewedIndex {
  const known = new Set(serverIds);
  const kept = Object.entries(index)
    .filter(([serverId]) => known.has(serverId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TRACKED_SERVERS);
  return Object.fromEntries(kept);
}
