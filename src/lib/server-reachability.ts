/**
 * Whether a server on the home screen is actually answering right now.
 *
 * This exists because the list used to draw a green dot from
 * `!isServerAgentsStale(...)` -- "the mirrored agent snapshot is under five
 * minutes old" -- and presented it as connectivity. A machine that had been
 * powered off two minutes ago still read as online, which is the one thing a
 * status light must never do.
 *
 * So connectivity is modelled separately from the mirror, and the two say
 * different things on purpose: the mirror says *what a server was running when
 * we last looked*, this says *whether it is answering now*. Neither is allowed
 * to stand in for the other.
 */

/**
 * Three states, not two. "We asked and got nothing" and "we never asked" are
 * different facts about the world, and collapsing them into one grey dot is how
 * a list ends up implying that an idle machine is down.
 */
export type ServerReachability = 'live' | 'offline' | 'unknown';

/** The result of one probe, held in memory for the life of the launch. */
export type ReachabilityProbe = {
  serverId: string;
  ok: boolean;
  checkedAtMs: number;
};

/**
 * How long a probe is allowed to speak for the present.
 *
 * Short on purpose: this drives a light labelled `ONLINE`, and the promise that
 * word makes is about now, not about the last minute. Anything older reverts to
 * `unknown` -- the app stops claiming, rather than starts guessing.
 */
export const REACHABILITY_FRESH_MS = 45 * 1000;

/**
 * Long enough that leaving the screen and coming back does not re-probe, short
 * enough that a machine going down while the list is open is noticed.
 */
export const REACHABILITY_RECHECK_MS = 30 * 1000;

/** A gateway that has not answered within this is treated as not answering. */
export const REACHABILITY_TIMEOUT_MS = 4000;

/**
 * How many servers the home screen is willing to ask about at once.
 *
 * The list used to ask exactly one -- the configured record -- and say
 * `NOT CONNECTED` about every other card. That was truthful, but it made the
 * common case wrong: someone with three machines saw one status light and two
 * shrugs, on a screen whose entire job is to say which machines are up.
 *
 * So the fan-out is bounded rather than forbidden. The reason it was forbidden
 * has not gone away -- each record carries its own pairing token, and a list
 * that probed everything would put every token on the wire on every launch --
 * but the mitigation that matters is a ceiling plus an ordering, not a limit of
 * one. Four is `MAX_WARM_SERVERS` (`lib/server-warm-cache.ts`), and for the same
 * reason: this exists to make the machines someone actually uses answer for
 * themselves, not to hold an opinion about every machine they have ever paired.
 *
 * Each token still goes only to the server that issued it. What the ceiling buys
 * is that a long-lived install with twenty paired records does not quietly become
 * a device that contacts twenty hosts every time the app is opened.
 */
export const MAX_PROBED_SERVERS = 4;

/**
 * Which servers get asked, in which order, out of the ones that *can* be asked.
 *
 * Eligibility is the caller's to decide and is deliberately not re-derived here:
 * the demo record, and any record reached through an SSH tunnel, are excluded
 * before this is called, because a tunnelled record's stored address belongs to
 * the SSH host rather than the gateway (`stores/server-reachability.ts`). This
 * function only answers "of the ones we may ask, which four".
 *
 * The configured server leads whenever it is eligible. It is the one the app is
 * already pointed at, the one whose workspace is warmed, and the one whose
 * answer the reader is most likely waiting on -- so it must not lose its place
 * to a machine that happens to have been opened more recently.
 *
 * After that, most recently viewed first. A server never opened on this device
 * has no mark and sorts last, keeping its position in the record list so the
 * order is stable rather than arbitrary; a fresh install with four records
 * therefore probes them top-down, which is the order they are drawn in.
 */
export function serversToProbe<T extends { serverId: string }>(
  eligible: readonly T[],
  lastViewedByServer: Readonly<Record<string, number>>,
  configuredServerId?: string,
  limit: number = MAX_PROBED_SERVERS
): T[] {
  if (limit <= 0) return [];
  const rank = (record: T, index: number) => {
    if (record.serverId === configuredServerId) return { tier: 0, at: 0, index };
    const at = lastViewedByServer[record.serverId];
    return typeof at === 'number' && Number.isFinite(at)
      ? { tier: 1, at, index }
      : { tier: 2, at: 0, index };
  };
  return eligible
    .map((record, index) => ({ record, ...rank(record, index) }))
    .sort((a, b) => a.tier - b.tier || b.at - a.at || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.record);
}

export function reachabilityFromProbe(
  probe: ReachabilityProbe | undefined,
  nowMs: number = Date.now()
): ServerReachability {
  if (!probe) return 'unknown';
  if (nowMs - probe.checkedAtMs > REACHABILITY_FRESH_MS) return 'unknown';
  return probe.ok ? 'live' : 'offline';
}

/** Whether a fresh enough answer is already on hand. */
export function needsReachabilityProbe(
  probe: ReachabilityProbe | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!probe) return true;
  return nowMs - probe.checkedAtMs >= REACHABILITY_RECHECK_MS;
}

// The words that travel with the dot used to be written here. They moved to
// `src/i18n/labels.ts` when the app learned a second language: this module
// decides *which* state a server is in, and the view layer decides what that
// state is called. The rule they carried has not changed -- colour alone is
// never a status, and the two greys ("asked, no answer" and "never asked") are
// told apart by the words and by the dot being hollow, never by hue.

/**
 * Whether what the mirror remembers is still worth colouring in.
 *
 * A stale snapshot was already dimmed; this adds the other half of the same
 * rule. If the machine is known not to be answering, nothing it last reported
 * is current either, so its agents drop to neutral rather than sitting there in
 * green. `unknown` deliberately does not: not having asked is not evidence.
 */
export function agentStatusesAreCurrent(
  reachability: ServerReachability,
  snapshotIsStale: boolean
): boolean {
  return !snapshotIsStale && reachability !== 'offline';
}
