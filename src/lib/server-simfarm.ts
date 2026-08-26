import { MAX_PORT, MIN_PORT } from '@/lib/web-service';

/**
 * The simfarm port each server was found on, so it is asked for once.
 *
 * A sibling of `server-web-ports.ts` and stored the same way, but a different
 * shape for a reason worth stating: that one keeps a *list*, because a developer
 * opens several dev servers on one machine and the feature's value is offering
 * the ones they used before. This keeps **one** number, because a machine runs
 * one simfarm. A list here would be a list with one entry in it, presented as a
 * choice the reader does not have.
 *
 * Most installs will never write to it at all. The probe finds simfarm on its
 * own default port and nothing is asked or remembered; this is what holds the
 * answer for the machine where someone moved it.
 *
 * A port number is not a secret, but it is a fact about a machine its owner did
 * not publish, so it is stored beside the sibling mirrors and never leaves the
 * device.
 */

/** Each server's simfarm port, keyed by local record id. */
export type ServerSimfarmIndex = Record<string, number>;

export const SERVER_SIMFARM_STORAGE_KEY = 'muqun.server-simfarm.v1';

/**
 * How many servers are remembered.
 *
 * The same reasoning as the sibling mirrors -- secure storage is not sized for
 * bulk data and a long-lived install should not accumulate entries for machines
 * it will never open again. Higher than the ports cap because this is one number
 * per server rather than six, so the same budget stretches further.
 */
export const MAX_REMEMBERED_SIMFARM_SERVERS = 24;

function isValidPort(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
  );
}

/**
 * The index out of whatever secure storage handed back.
 *
 * Re-validated on read rather than trusted, exactly like the sibling mirrors: a
 * value written by an older build, or a file half-written when the app was
 * killed, must degrade to "ask again" and never to a URL with `NaN` in it.
 */
export function parseServerSimfarmIndex(raw: string | null): ServerSimfarmIndex {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const index: ServerSimfarmIndex = {};
  for (const [serverId, port] of Object.entries(parsed as Record<string, unknown>)) {
    if (serverId === '') continue;
    if (isValidPort(port)) index[serverId] = port;
  }
  return index;
}

/**
 * `index` with this server's port recorded, trimmed to the cap.
 *
 * Re-inserted at the end rather than updated in place, so the trim drops the
 * server nobody has previewed in the longest time -- the same rule the pane
 * memory uses, and the only one that does not eventually forget the machine
 * being used right now.
 */
export function withSimfarmPort(
  index: ServerSimfarmIndex,
  serverId: string,
  port: number
): ServerSimfarmIndex {
  if (serverId === '' || !isValidPort(port)) return index;
  if (index[serverId] === port) return index;

  const { [serverId]: _dropped, ...rest } = index;
  const entries = Object.entries(rest);
  const kept = entries.slice(Math.max(0, entries.length - (MAX_REMEMBERED_SIMFARM_SERVERS - 1)));
  return { ...Object.fromEntries(kept), [serverId]: port };
}

/** `index` without this server, for a record that has been unpaired. */
export function withoutSimfarmServer(
  index: ServerSimfarmIndex,
  serverId: string
): ServerSimfarmIndex {
  if (!(serverId in index)) return index;
  const { [serverId]: _dropped, ...rest } = index;
  return rest;
}
