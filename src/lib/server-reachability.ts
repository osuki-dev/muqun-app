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
