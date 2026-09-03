/**
 * What each paired gateway said it could do, the last time the app spoke to it.
 *
 * The home screen has to gate an entry point on a capability, and it cannot ask
 * for one: only one gateway connection is open at a time, and probing every
 * card would put every pairing token on the wire to draw a menu (the same
 * reason the agent mirror in `server-agents.ts` exists instead of a fan-out
 * query). So this is a mirror on exactly that model -- the server screen writes
 * down the capability list `/health` handed it, the home screen reads it back.
 *
 * The consequence is deliberate and worth stating: a server that has never been
 * opened on this device offers no New Task entry on its card, because nothing
 * has ever asked it what it can do. Opening it once is what teaches the list.
 * The alternative -- assuming a modern gateway until proven otherwise -- puts a
 * row on screen that fails when tapped, and this feature's whole rule is that a
 * gateway which cannot do this is never offered it.
 *
 * Nothing secret travels here: capability names are a fixed, public vocabulary.
 */

/** Every server's latest capability list, keyed by local record id. */
export type ServerCapabilitiesIndex = Record<string, string[]>;

export const SERVER_CAPABILITIES_STORAGE_KEY = 'muqun.server-capabilities.v1';

/**
 * A cap on both axes, for the same reason the agent mirror has one: secure
 * storage is not sized for bulk data, and a long-lived install should not
 * accumulate lists for servers it will never show again.
 */
export const MAX_MIRRORED_CAPABILITY_SERVERS = 24;
const MAX_CAPABILITIES = 48;
const MAX_CAPABILITY_LENGTH = 48;

/**
 * One `/health` answer, reduced to the names worth keeping.
 *
 * Anything that is not a plain non-empty string is dropped rather than kept as
 * a falsy entry, because every reader asks `includes(...)` and a list that can
 * contain rubbish makes that question unsafe to trust.
 */
export function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim().slice(0, MAX_CAPABILITY_LENGTH);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= MAX_CAPABILITIES) break;
  }
  return names;
}

/** Whether a fresh list says anything the stored one did not, or vice versa. */
export function sameCapabilities(previous: string[] | undefined, next: readonly string[]): boolean {
  if (!previous || previous.length !== next.length) return false;
  return previous.every((name, index) => name === next[index]);
}

/**
 * The mirror with one more server written into it, kept under the cap.
 *
 * Trimmed by write order -- the least recently answered server is the one that
 * goes -- rather than by pruning against the paired list, which is the agent
 * mirror's approach and needs a screen holding that list to call it. Nothing
 * here needs one: an entry for a server this device has unpaired is never read,
 * because a reader arrives with a server id in hand and gets its own answer or
 * nothing. The cap is the only real concern, and this bounds it at the one
 * place the index grows.
 */
export function withMirroredCapabilities(
  index: ServerCapabilitiesIndex,
  serverId: string,
  capabilities: readonly string[]
): ServerCapabilitiesIndex {
  // Re-inserted rather than updated in place, so answering again moves a server
  // to the young end and the cap evicts what has genuinely gone quiet.
  const { [serverId]: _replaced, ...rest } = index;
  const entries = Object.entries(rest);
  const kept = entries.slice(Math.max(0, entries.length - (MAX_MIRRORED_CAPABILITY_SERVERS - 1)));
  return { ...Object.fromEntries(kept), [serverId]: [...capabilities] };
}

export function parseServerCapabilitiesIndex(value: string): ServerCapabilitiesIndex {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const index: ServerCapabilitiesIndex = {};
    for (const [serverId, capabilities] of Object.entries(parsed as Record<string, unknown>)) {
      if (!serverId) continue;
      const names = normalizeCapabilities(capabilities);
      if (names.length > 0) index[serverId] = names;
    }
    return index;
  } catch {
    // A mirror that cannot be read is a home screen with no New Task entries,
    // which is what it showed before this feature existed.
    return {};
  }
}
