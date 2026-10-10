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

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what}: ${response.status} ${await response.text()}`);
  return response;
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

export async function fetchFleetPeers(endpoint: FleetEndpoint): Promise<FleetPeersFetch> {
  let response: Response;
  try {
    response = await endpointRequest(endpoint, '/api/peers', 'GET');
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

/** A pairing code on this computer for another one (`kind: gateway`). */
export async function mintPairingCode(
  endpoint: FleetEndpoint,
  forComputer: { name: string; serverId: string }
): Promise<{ requestId: string; code: string }> {
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
  return { requestId, code };
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

export async function renamePeer(
  endpoint: FleetEndpoint,
  peerId: string,
  name: string
): Promise<void> {
  await expectOk(
    await endpointRequest(endpoint, `/api/peers/${encodeURIComponent(peerId)}`, 'PATCH', {
      name,
    }),
    'Rename peer'
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

/** A computer the phone unpaired, until every other computer has let it go. */
export type Tombstone = { serverId: string; buriedAtMs: number };

/** How long an unpaired computer is chased on the others, and how many are. */
export const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
export const MAX_TOMBSTONES = 32;

/** The tombstones still worth chasing: none older than a month, the newest 32. */
export function keptTombstones(entries: readonly Tombstone[], nowMs: number): Tombstone[] {
  return entries
    .filter((entry) => nowMs - entry.buriedAtMs < TOMBSTONE_MAX_AGE_MS)
    .sort((a, b) => b.buriedAtMs - a.buriedAtMs)
    .slice(0, MAX_TOMBSTONES);
}

/**
 * The tombstones a run may let go: none unless every linkable computer
 * answered (a silent one may still hold any), and of those, every one whose
 * cleanup did not fail somewhere this run.
 */
export function settledTombstones(
  computers: readonly FleetComputer[],
  tombstones: readonly string[],
  failed: ReadonlySet<string>
): string[] {
  if (computers.some((computer) => !computer.peers)) return [];
  return tombstones.filter((serverId) => !failed.has(serverId));
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

/**
 * Every peer row, on a computer that answered, of a computer the phone has
 * unpaired: each one is deleted there (§5.3, "disappears everywhere").
 */
export function planTombstoneUnlinks(
  computers: readonly FleetComputer[],
  tombstones: readonly string[]
): { from: string; peerId: string; serverId: string }[] {
  const gone = new Set(tombstones);
  const steps: { from: string; peerId: string; serverId: string }[] = [];
  for (const from of computers) {
    for (const peer of from.peers?.peers ?? []) {
      if (gone.has(peer.serverId)) {
        steps.push({ from: from.serverId, peerId: peer.peerId, serverId: peer.serverId });
      }
    }
  }
  return steps;
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
 * Every ordered pair (A, B) of computers that both answered, where B takes
 * work and A does not list B yet, unless linking A to B failed within the
 * retry window. A peer A lists but cannot reach stays as it is: it is linked,
 * just quiet, and a new pairing would not make it answer.
 */
export function planFleetLinks(
  computers: readonly FleetComputer[],
  failures: Readonly<Record<string, number>>,
  nowMs: number
): { from: string; to: string }[] {
  const steps: { from: string; to: string }[] = [];
  for (const from of computers) {
    if (!from.peers) continue;
    for (const to of computers) {
      if (to.serverId === from.serverId || !to.peers?.acceptDelegations) continue;
      if (lists(from, to.serverId)) continue;
      if (failedRecently(failures, from.serverId, to.serverId, nowMs)) continue;
      steps.push({ from: from.serverId, to: to.serverId });
    }
  }
  return steps;
}

/**
 * The one line Settings shows for `serverId`: the computers it is linked with
 * and answering, and those it is linked with but cannot reach or failed to
 * link this round. Named by this phone's label, else the gateway's name.
 */
export function linkLines(
  serverId: string,
  computers: readonly FleetComputer[],
  failures: Readonly<Record<string, number>>,
  nowMs: number
): { linked: string[]; cannotReach: string[] } {
  const self = computers.find((entry) => entry.serverId === serverId);
  const labelOf = (peer: PeerView) =>
    computers.find((entry) => entry.serverId === peer.serverId)?.label || peer.name;
  const linked: string[] = [];
  const cannotReach: string[] = [];
  for (const peer of self?.peers?.peers ?? []) {
    (peer.reachable ? linked : cannotReach).push(labelOf(peer));
  }
  for (const other of computers) {
    if (other.serverId === serverId || (self && lists(self, other.serverId))) continue;
    if (failedRecently(failures, serverId, other.serverId, nowMs)) cannotReach.push(other.label);
  }
  return { linked, cannotReach };
}

/** Every peer entry whose name differs from this phone's label for that computer (§10.16). */
export function planRenames(
  computers: readonly FleetComputer[]
): { from: string; peerId: string; name: string }[] {
  const renames: { from: string; peerId: string; name: string }[] = [];
  for (const from of computers) {
    for (const peer of from.peers?.peers ?? []) {
      const label = computers.find((entry) => entry.serverId === peer.serverId)?.label.trim();
      if (label && label !== peer.name) {
        renames.push({ from: from.serverId, peerId: peer.peerId, name: label });
      }
    }
  }
  return renames;
}
