/**
 * The ports a reader has opened on each server, most recent first.
 *
 * This exists so the second use of the feature is a tap instead of typing. A
 * developer's dev server is on the same port every day; making them type `3000`
 * into a phone keyboard each time would be the whole convenience spent on
 * ceremony.
 *
 * Same shape as the capability mirror in `server-capabilities.ts` and for the
 * same reason: keyed by local record id, capped on both axes, re-validated on
 * read. The difference worth naming is what it is a mirror *of*. Capabilities
 * mirror something the gateway said; this mirrors something the reader did, so
 * nothing refreshes it and nothing else can reconstruct it. Losing it is not a
 * stale answer, it is a forgotten shortcut -- which is why it is written on use
 * rather than on some poll.
 *
 * A port number is not a secret, but it is a fact about a machine that its owner
 * did not publish, so it is stored the way the sibling mirrors are and never
 * leaves the device.
 */

/** Every server's recently opened ports, newest first, keyed by record id. */
export type ServerWebPortsIndex = Record<string, number[]>;

export const SERVER_WEB_PORTS_STORAGE_KEY = 'muqun.server-web-ports.v1';

/**
 * A cap on both axes, matching the capability mirror's reasoning: secure storage
 * is not sized for bulk data, and a long-lived install should not accumulate
 * lists for servers it will never open again.
 *
 * Six ports rather than the five recent directories the New task sheet shows.
 * These are three or four characters each and sit on one wrapped row, so the
 * sixth costs nothing on screen -- where a sixth directory would have pushed the
 * field it sits above off a sheet sized to its contents.
 */
export const MAX_MIRRORED_PORT_SERVERS = 24;
export const MAX_RECENT_PORTS = 6;

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * One stored list, reduced to the numbers worth keeping.
 *
 * Anything that is not a whole number in range is dropped rather than repaired.
 * Every reader turns these straight into a URL and a tappable chip, so a list
 * that can contain `0`, `1.5` or `"3000"` makes a chip that cannot be trusted to
 * open what it says.
 */
export function normalizePorts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ports: number[] = [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
    if (entry < MIN_PORT || entry > MAX_PORT) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    ports.push(entry);
    if (ports.length >= MAX_RECENT_PORTS) break;
  }
  return ports;
}

/**
 * The list with `port` promoted to the front.
 *
 * Opening a port that is already remembered moves it rather than duplicating it,
 * so the row stays a set of distinct ports and re-opening the usual one keeps it
 * where the thumb already expects it.
 */
export function withRecentPort(previous: readonly number[] | undefined, port: number): number[] {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return normalizePorts(previous ? [...previous] : []);
  }
  const rest = (previous ?? []).filter((entry) => entry !== port);
  return normalizePorts([port, ...rest]);
}

/** Whether a fresh list differs from the stored one. */
export function samePorts(previous: number[] | undefined, next: readonly number[]): boolean {
  if (!previous || previous.length !== next.length) return false;
  return previous.every((port, index) => port === next[index]);
}

/**
 * The mirror with one server's list replaced, kept under the cap.
 *
 * Re-inserted rather than updated in place, so a server that was just used moves
 * to the young end and the cap evicts what has genuinely gone quiet. A server
 * whose list has emptied is removed outright rather than kept as `[]`, because
 * an empty list and an absent one mean the same thing to every reader and only
 * one of them takes up a slot.
 */
export function withMirroredPorts(
  index: ServerWebPortsIndex,
  serverId: string,
  ports: readonly number[]
): ServerWebPortsIndex {
  const { [serverId]: _replaced, ...rest } = index;
  if (ports.length === 0) return rest;
  const entries = Object.entries(rest);
  const kept = entries.slice(Math.max(0, entries.length - (MAX_MIRRORED_PORT_SERVERS - 1)));
  return { ...Object.fromEntries(kept), [serverId]: [...ports] };
}

export function parseServerWebPortsIndex(value: string): ServerWebPortsIndex {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const index: ServerWebPortsIndex = {};
    for (const [serverId, ports] of Object.entries(parsed as Record<string, unknown>)) {
      if (!serverId) continue;
      const kept = normalizePorts(ports);
      if (kept.length > 0) index[serverId] = kept;
    }
    return index;
  } catch {
    // A mirror that cannot be read is a sheet with no shortcut chips, which is
    // what it showed the first time it was ever opened.
    return {};
  }
}
