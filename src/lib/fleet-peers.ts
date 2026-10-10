import { asFiniteNumber, asRecord, asString } from './agent-protocol';
import { normalizeCapabilities } from './server-capabilities';
import type { TaskEndpoint } from './task-ledger';

/**
 * The reader's computers linked to each other (`GET/POST /api/peers`,
 * `POST /api/pair/pending`, `PUT /api/fleet/settings`). A gateway without it is
 * never asked and shows nothing new.
 */
export const FLEET_PEERS_CAPABILITY = 'fleet_peers';

export function hasFleetPeers(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(FLEET_PEERS_CAPABILITY) ?? false;
}

/**
 * One computer another one is linked with. `peerId` is the linking gateway's
 * own id for the link (what `PATCH`/`DELETE /api/peers/{id}` take); `serverId`
 * is the peer's own server id, which is this phone's `GatewayRecord.serverId`
 * for it.
 */
export interface PeerView {
  peerId: string;
  serverId: string;
  name: string;
  url: string;
  reachable: boolean;
  lastSeenMs?: number;
}

export interface FleetPeers {
  acceptDelegations: boolean;
  peers: PeerView[];
}

function parsePeer(value: unknown): PeerView | null {
  const rec = asRecord(value);
  const peerId = asString(rec?.peer_id);
  const serverId = asString(rec?.server_id);
  if (!rec || !peerId || !serverId) return null;
  const lastSeenMs = asFiniteNumber(rec.last_seen_ms);
  return {
    peerId,
    serverId,
    name: asString(rec.name) ?? '',
    url: asString(rec.url) ?? '',
    reachable: rec.reachable === true,
    ...(lastSeenMs !== undefined ? { lastSeenMs } : {}),
  };
}

/** `GET /api/peers`; a body without a `peers` array is no answer. */
export function parseFleetPeers(value: unknown): FleetPeers | null {
  const rec = asRecord(value);
  if (!rec || !Array.isArray(rec.peers)) return null;
  return {
    acceptDelegations: rec.accept_delegations !== false,
    peers: rec.peers.map(parsePeer).filter((peer): peer is PeerView => peer !== null),
  };
}

export type FleetEndpoint = TaskEndpoint;

/** Linking runs Argon2 on both computers and a round trip between them. */
const LINK_TIMEOUT_MS = 30_000;

async function endpointRequest(
  endpoint: FleetEndpoint,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  timeoutMs?: number
): Promise<Response> {
  const { gatewayEndpointFetch } = await import('./gateway-client');
  const base = endpoint.url.replace(/\/$/, '');
  return gatewayEndpointFetch(
    endpoint as Parameters<typeof gatewayEndpointFetch>[0],
    `${base}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    timeoutMs
  );
}

/** A refusal from a fleet route: its status and the gateway's `error.code`. */
export class FleetRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined
  ) {
    super(message);
  }
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text().catch(() => '');
  let code: string | undefined;
  try {
    code = asString(asRecord(asRecord(JSON.parse(text))?.error)?.code);
  } catch {
    code = undefined;
  }
  throw new FleetRequestError(`${what}: ${response.status} ${text}`, response.status, code);
}

/** The gateway code a failed fleet request carried, if any. */
export function fleetErrorCode(failure: unknown): string | undefined {
  return failure instanceof FleetRequestError ? failure.code : undefined;
}

/** `POST`/`PATCH /api/peers` refused the name: it is the computer's own, or another peer's. */
export function nameConflictOf(failure: unknown): 'self' | 'peer' | null {
  const code = fleetErrorCode(failure);
  return code === 'name_conflict' ? 'self' : code === 'peer_name_taken' ? 'peer' : null;
}

/** An address that means the phone itself (adb reverse, an emulator), never another computer. */
export function isLoopbackUrl(url: string): boolean {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#]*)/i.exec(url.trim())?.[1]?.toLowerCase();
  if (!host) return false;
  return (
    host === 'localhost' ||
    host === '[::1]' ||
    host === '10.0.2.2' ||
    host.startsWith('127.') ||
    host.endsWith('.localhost')
  );
}

/**
 * How a `GET /api/peers` went: the answer, or why there is none -- an HTTP
 * status (a refusal included), no answer at all, or a body that was not one.
 */
export type FleetPeersFetch =
  | { ok: true; peers: FleetPeers }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'parse' };

/** The computer no longer accepts this phone: what the phone knew of its links is void. */
export function refusesPhone(result: FleetPeersFetch): boolean {
  return !result.ok && result.reason === 'http' && (result.status === 401 || result.status === 403);
}

export async function fetchFleetPeers(
  endpoint: FleetEndpoint,
  timeoutMs?: number
): Promise<FleetPeersFetch> {
  let response: Response;
  try {
    response = await endpointRequest(endpoint, '/api/peers', 'GET', undefined, timeoutMs);
  } catch (error) {
    // The encrypted transport turns a plaintext refusal into an error that
    // still carries the status.
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number'
      ? { ok: false, reason: 'http', status }
      : { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'http', status: response.status };
  const peers = parseFleetPeers(await response.json().catch(() => null));
  return peers ? { ok: true, peers } : { ok: false, reason: 'parse' };
}

/**
 * What `POST /api/pair/pending` takes for another computer: its name, and its
 * server id, so the device record made for it can be revoked when that
 * computer's link goes (an older gateway ignores the field).
 */
export function pairingCodeBody(
  deviceName: string,
  serverId: string
): { device_name: string; kind: 'gateway'; server_id: string } {
  return { device_name: deviceName.trim(), kind: 'gateway', server_id: serverId };
}

/** How long a minted code lives when the gateway does not say (older gateways: 5 min). */
const DEFAULT_CODE_LIFETIME_MS = 60_000;

/**
 * A pairing code on this computer for another one (`kind: gateway`), and how
 * long it lives (`expires_in_ms`): after that it is gone, never used again.
 */
export async function mintPairingCode(
  endpoint: FleetEndpoint,
  forComputer: { name: string; serverId: string }
): Promise<{ requestId: string; code: string; expiresInMs: number }> {
  const response = await expectOk(
    await endpointRequest(
      endpoint,
      '/api/pair/pending',
      'POST',
      pairingCodeBody(forComputer.name, forComputer.serverId)
    ),
    'Mint pairing code'
  );
  const rec = asRecord(await response.json());
  const requestId = asString(rec?.request_id);
  const code = asString(rec?.code);
  if (!requestId || !code) throw new Error('Mint pairing code: no code in the answer');
  return {
    requestId,
    code,
    expiresInMs: asFiniteNumber(rec?.expires_in_ms) ?? DEFAULT_CODE_LIFETIME_MS,
  };
}

/**
 * Give back a minted code the other computer never claimed, so its single
 * pending slot is free at once (`DELETE /api/pair/pending/{id}`, with the
 * token that minted it). Best effort: a 404 is a code already gone; a 403
 * (`peer_forbidden`) is logged.
 */
export async function cancelPairingCode(endpoint: FleetEndpoint, requestId: string): Promise<void> {
  const response = await endpointRequest(
    endpoint,
    `/api/pair/pending/${encodeURIComponent(requestId)}`,
    'DELETE'
  ).catch(() => null);
  if (response?.status === 403) {
    console.warn('[fleet] cancel pairing code refused', await response.text().catch(() => ''));
  }
}

/** The computer's own label (`GET /api/fleet/self`), the name its peers know it by. */
export async function fetchSelfLabel(endpoint: FleetEndpoint): Promise<string | null> {
  try {
    const response = await endpointRequest(endpoint, '/api/fleet/self', 'GET');
    if (!response.ok) return null;
    const label = asString(asRecord(await response.json())?.label)?.trim();
    return label || null;
  } catch {
    return null;
  }
}

/** Ask this computer to pair itself with the one at `url` through its code. */
export async function linkPeer(
  endpoint: FleetEndpoint,
  link: { url: string; name: string; requestId: string; code: string }
): Promise<void> {
  await expectOk(
    await endpointRequest(
      endpoint,
      '/api/peers',
      'POST',
      { url: link.url, name: link.name, request_id: link.requestId, code: link.code },
      LINK_TIMEOUT_MS
    ),
    'Link peer'
  );
}

/** Forget a peer; one this computer does not know is already forgotten. */
export async function unlinkPeer(endpoint: FleetEndpoint, peerId: string): Promise<void> {
  const response = await endpointRequest(
    endpoint,
    `/api/peers/${encodeURIComponent(peerId)}`,
    'DELETE',
    undefined,
    LINK_TIMEOUT_MS
  );
  if (response.status !== 404) await expectOk(response, 'Unlink peer');
}

/**
 * Tell this computer a peer's new address. The gateway proves it first and
 * keeps the old one when nothing there knows the link.
 */
export async function movePeer(
  endpoint: FleetEndpoint,
  peerId: string,
  url: string
): Promise<void> {
  await expectOk(
    await endpointRequest(
      endpoint,
      `/api/peers/${encodeURIComponent(peerId)}`,
      'PATCH',
      { url },
      LINK_TIMEOUT_MS
    ),
    'Move peer'
  );
}

/** The public capability list, or `null` when the computer did not answer. */
export async function fetchCapabilities(endpoint: FleetEndpoint): Promise<string[] | null> {
  try {
    const response = await endpointRequest(endpoint, '/api/capabilities', 'GET');
    if (!response.ok) return null;
    return normalizeCapabilities(asRecord(await response.json())?.capabilities);
  } catch {
    return null;
  }
}

/** Write the switch; what the computer now says it is. */
export async function setAcceptDelegations(
  endpoint: FleetEndpoint,
  accept: boolean
): Promise<boolean> {
  const response = await expectOk(
    await endpointRequest(endpoint, '/api/fleet/settings', 'PUT', {
      accept_delegations: accept,
    }),
    'Fleet settings'
  );
  return asRecord(await response.json())?.accept_delegations !== false;
}

/**
 * The server id of the computer a mirror runs on: the one the mirror names,
 * else the one a linked computer lists under that link id, else the link id.
 * Link ids are minted per link, so any computer's list will do.
 */
export function peerServerIdOf(
  byServer: Readonly<Record<string, FleetPeers>>,
  binding: { peerId: string; peerServerId?: string }
): string {
  if (binding.peerServerId) return binding.peerServerId;
  for (const answer of Object.values(byServer)) {
    const peer = answer.peers.find((entry) => entry.peerId === binding.peerId);
    if (peer) return peer.serverId;
  }
  return binding.peerId;
}

/** A paired device that is another computer, with the server id it gave (newer gateways). */
export type PairedGateway = { deviceId: string; serverId: string };

/** A gateway that lists and revokes its paired devices (`GET`/`DELETE /api/pairings`). */
export const DEVICE_REVOCATION_CAPABILITY = 'device_revocation';

/**
 * `GET /api/pairings`: the other computers' logins here; `'no-route'` for a
 * 404, which `pairingsAnswer` judges; `null` when it did not answer.
 */
export async function fetchPairedGateways(
  endpoint: FleetEndpoint
): Promise<PairedGateway[] | 'no-route' | null> {
  try {
    const response = await endpointRequest(endpoint, '/api/pairings', 'GET');
    if (response.status === 404) return 'no-route';
    if (!response.ok) return null;
    const devices = asRecord(await response.json())?.devices;
    if (!Array.isArray(devices)) return null;
    return devices.flatMap((entry): PairedGateway[] => {
      const rec = asRecord(entry);
      const deviceId = asString(rec?.id);
      const serverId = asString(rec?.server_id);
      return rec?.kind === 'gateway' && deviceId && serverId ? [{ deviceId, serverId }] : [];
    });
  } catch {
    return null;
  }
}

/**
 * What a pairings read means for the cleanup: the logins, or nothing to
 * revoke when the 404 came from a gateway that says (in this run's
 * `/api/capabilities`) it has no such list. A 404 from anything else -- a
 * proxy in front of a gateway that has the list -- is no answer: retried.
 */
export function pairingsAnswer(
  listed: PairedGateway[] | 'no-route' | null,
  capabilities: readonly string[] | null
): PairedGateway[] | null {
  if (listed !== 'no-route') return listed;
  return capabilities !== null && !capabilities.includes(DEVICE_REVOCATION_CAPABILITY) ? [] : null;
}

/** Revoke one paired device; one already gone is revoked. */
export async function revokePairing(endpoint: FleetEndpoint, deviceId: string): Promise<void> {
  const response = await endpointRequest(
    endpoint,
    `/api/pairings/${encodeURIComponent(deviceId)}`,
    'DELETE'
  );
  if (response.status !== 404) await expectOk(response, 'Revoke pairing');
}

/** What one computer said, as the reconciler saw it this run. */
export type FleetComputer = {
  serverId: string;
  label: string;
  url: string;
  peers: FleetPeers | null;
};

/** How long a link that failed is left alone before it is tried again. */
export const LINK_RETRY_MS = 10 * 60_000;

export function failureKey(from: string, to: string): string {
  return `${from}\n${to}`;
}

function lists(computer: FleetComputer, serverId: string): boolean {
  return computer.peers?.peers.some((peer) => peer.serverId === serverId) ?? false;
}

function failedRecently(
  failures: Readonly<Record<string, number>>,
  from: string,
  to: string,
  nowMs: number
): boolean {
  const failedAt = failures[failureKey(from, to)];
  return failedAt !== undefined && nowMs - failedAt < LINK_RETRY_MS;
}

/**
 * Two computers whose names collide where one would be linked to the other:
 * `name` (B's own label) is A's own label (`against: 'self'`) or the name of
 * a peer A already has (`'peer'`, `with` naming it). Not retried until one of
 * the names changes.
 */
export type NameConflict = {
  name: string;
  against: 'self' | 'peer';
  with: string;
  /** A's own label, for the Settings line. */
  fromName?: string;
  /**
   * The peer A holds under that name is no computer this device knows: an
   * older entry for the same machine (a reinstall gave it a new server id).
   * The remedy is removing that entry on A, not renaming anything.
   */
  stale?: boolean;
};

/**
 * Every ordered pair (A, B) of computers that both answered, where B takes
 * work and A does not list B yet, unless linking A to B failed within the
 * retry window or its names collide (`conflicts`). A peer A lists but cannot
 * reach stays linked (`planPeerMoves` handles a moved one). B at a loopback
 * address is never handed to A: it would mean A itself.
 */
export function planFleetLinks(
  computers: readonly FleetComputer[],
  failures: Readonly<Record<string, number>>,
  nowMs: number,
  conflicts: Readonly<Record<string, NameConflict>> = {}
): { from: string; to: string }[] {
  const steps: { from: string; to: string }[] = [];
  for (const from of computers) {
    if (!from.peers) continue;
    for (const to of computers) {
      if (to.serverId === from.serverId || !to.peers?.acceptDelegations) continue;
      if (lists(from, to.serverId) || isLoopbackUrl(to.url)) continue;
      if (failureKey(from.serverId, to.serverId) in conflicts) continue;
      if (failedRecently(failures, from.serverId, to.serverId, nowMs)) continue;
      steps.push({ from: from.serverId, to: to.serverId });
    }
  }
  return steps;
}

/**
 * The lines Settings shows for `serverId`: the computers it is linked with
 * and answering, those of them that take no work, those it is linked with but
 * cannot reach or failed to link, and the pairs whose names collide. Named by
 * this phone's label, else the gateway's name.
 */
export function linkLines(
  serverId: string,
  computers: readonly FleetComputer[],
  failures: Readonly<Record<string, number>>,
  nowMs: number,
  conflicts: Readonly<Record<string, NameConflict>> = {}
): {
  linked: string[];
  noWork: string[];
  cannotReach: string[];
  sameName: { name: string; with: string; from: string; stale: boolean }[];
} {
  const self = computers.find((entry) => entry.serverId === serverId);
  const labelOf = (peer: PeerView) =>
    computers.find((entry) => entry.serverId === peer.serverId)?.label || peer.name;
  const linked: string[] = [];
  const noWork: string[] = [];
  const cannotReach: string[] = [];
  const sameName: { name: string; with: string; from: string; stale: boolean }[] = [];
  for (const peer of self?.peers?.peers ?? []) {
    if (!peer.reachable) {
      cannotReach.push(labelOf(peer));
      continue;
    }
    linked.push(labelOf(peer));
    const own = computers.find((entry) => entry.serverId === peer.serverId)?.peers;
    if (own && !own.acceptDelegations) noWork.push(labelOf(peer));
  }
  for (const other of computers) {
    if (other.serverId === serverId || (self && lists(self, other.serverId))) continue;
    const conflict = conflicts[failureKey(serverId, other.serverId)];
    if (conflict) {
      // The computers' own labels: the clash is between those, not this
      // device's names for them.
      sameName.push({
        name: conflict.name,
        with: conflict.with,
        from: conflict.fromName ?? self?.label ?? '',
        stale: conflict.stale === true,
      });
    } else if (failedRecently(failures, serverId, other.serverId, nowMs)) {
      cannotReach.push(other.label);
    }
  }
  return { linked, noWork, cannotReach, sameName };
}

/** An address as a link compares it: scheme and host in lower case, no trailing slash. */
function sameUrl(a: string, b: string): boolean {
  const normal = (url: string) =>
    url
      .trim()
      .replace(/\/+$/, '')
      .replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i, (head) => head.toLowerCase());
  return normal(a) === normal(b);
}

/**
 * Every peer a computer lists but cannot reach whose address on this phone is
 * another (it moved: a new lease, a new tailnet address): that computer is
 * told the new one -- only when the moved computer answered this device this
 * pass, so the gateway's proof of the new address has something to reach. A
 * peer that answers is never touched, so a link that works over another route
 * stays as it is; a loopback address is never handed on; addresses are
 * compared normalized (a trailing slash is no move); and a move that failed
 * waits out the retry window.
 */
export function planPeerMoves(
  computers: readonly FleetComputer[],
  failures: Readonly<Record<string, number>>,
  nowMs: number
): { from: string; peerId: string; url: string }[] {
  const moves: { from: string; peerId: string; url: string }[] = [];
  for (const from of computers) {
    for (const peer of from.peers?.peers ?? []) {
      if (peer.reachable) continue;
      const moved = computers.find((entry) => entry.serverId === peer.serverId);
      if (!moved?.peers) continue;
      const url = moved.url;
      if (!url || sameUrl(url, peer.url) || isLoopbackUrl(url)) continue;
      if (failedRecently(failures, from.serverId, peer.peerId, nowMs)) continue;
      moves.push({ from: from.serverId, peerId: peer.peerId, url });
    }
  }
  return moves;
}
