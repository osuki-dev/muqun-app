/**
 * The real wiring behind `GatewaySocket`: nitro-websockets, quick-crypto,
 * `AppState`, and the shared gateway client's address and credentials.
 *
 * Kept apart from `gateway-socket.ts` so that one stays testable under bun.
 */
import { AppState } from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';

import { activeLocaleHeaders } from '@/i18n/active-locale';

import { mirroredDiscoveryFor } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';

import type { SocketFrameCrypto } from './agent-socket-codec';
import { isDemoActive, isDemoRecord } from './demo-gateway';
import {
  configuredGatewayServerId,
  encryptedEventStreamRequest,
  type GatewayEndpoint,
  gatewayAuthHeaders,
  gatewayUrl,
  isGatewayConfigured,
} from './gateway-client';
import {
  GatewaySocket,
  gatewaySocketPath,
  type GatewaySocketTransport,
  type GatewaySocketUpgrade,
  type SocketAuthorization,
} from './gateway-socket';
import { authorizationFromProbe } from './server-reachability';
import { streamRecordCrypto } from './gateway-transport';
import { onNetworkChange } from './network-events';

const TAG_BYTES = 16;

function fromBase64Url(value: string) {
  return QuickCrypto.Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export const socketFrameCrypto: SocketFrameCrypto = {
  hkdf: (material, salt, info) => streamRecordCrypto.hkdf(material, salt, info),
  seal(key, nonce, aad, plaintext) {
    const cipher = QuickCrypto.createCipheriv(
      'aes-256-gcm',
      QuickCrypto.Buffer.from(key),
      QuickCrypto.Buffer.from(nonce)
    );
    cipher.setAAD(QuickCrypto.Buffer.from(aad, 'utf8'));
    return QuickCrypto.Buffer.concat([
      cipher.update(QuickCrypto.Buffer.from(plaintext, 'utf8')),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64url');
  },
  open(key, nonce, aad, ciphertext) {
    const sealed = fromBase64Url(ciphertext);
    if (sealed.length < TAG_BYTES) throw new Error('The server sent an invalid socket frame.');
    const decipher = QuickCrypto.createDecipheriv(
      'aes-256-gcm',
      QuickCrypto.Buffer.from(key),
      QuickCrypto.Buffer.from(nonce)
    );
    decipher.setAAD(QuickCrypto.Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return QuickCrypto.Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  },
};

/**
 * The upgrade for `serverId`, sealed fresh: the gateway replay-caches the
 * envelope nonce and binds the frame keys to it. Null when the shared client
 * is pointed at another server, at the demo, or at nothing.
 */
async function prepareUpgrade(serverId: string): Promise<GatewaySocketUpgrade | null> {
  if (isDemoActive()) return null;
  if (!isGatewayConfigured() || configuredGatewayServerId() !== serverId) {
    return prepareStoredUpgrade(serverId);
  }
  // Read per attempt, so a reconnect follows a discovery answered since.
  const path = gatewaySocketPath(mirroredDiscoveryFor(serverId)?.transports);
  if (!path) return null;
  const httpUrl = gatewayUrl(path);
  const url = httpUrl.replace(/^http(s?):\/\//i, (_, secure: string) => `ws${secure}://`);
  if (!/^wss?:\/\//i.test(url)) return null;
  // The AAD is path-only, so sealing against the http spelling is the same
  // request the gateway sees.
  const sealed = await encryptedEventStreamRequest(httpUrl);
  if (!sealed) return { url, headers: gatewayAuthHeaders(), seal: null };
  return {
    url,
    // The token rides inside the envelope; only the locale stays readable.
    headers: { ...activeLocaleHeaders(), ...sealed.headers },
    seal: {
      requestAad: sealed.requestAad,
      requestNonce: sealed.requestNonce,
      material: sealed.material,
    },
  };
}

/**
 * A paired computer that is not the selected one, reached through its own
 * stored address and credentials: Home's computer cards keep a task-only
 * socket open to it. Never for a tunnelled record -- its stored address is
 * the gateway's on the SSH host, and from here that is the phone's own
 * loopback -- nor for the demo.
 */
async function prepareStoredUpgrade(serverId: string): Promise<GatewaySocketUpgrade | null> {
  const record = directRecord(serverId);
  if (!record) return null;
  const path = gatewaySocketPath(mirroredDiscoveryFor(serverId)?.transports);
  if (!path) return null;
  const httpUrl = `${record.url.replace(/\/$/, '')}${path}`;
  const url = httpUrl.replace(/^http(s?):\/\//i, (_, secure: string) => `ws${secure}://`);
  if (!/^wss?:\/\//i.test(url)) return null;
  const endpoint: GatewayEndpoint = {
    url: record.url,
    token: record.token,
    ...(record.deviceId ? { deviceId: record.deviceId } : {}),
    ...(record.transportKey ? { transportKey: record.transportKey } : {}),
    ...(record.transport ? { transport: record.transport } : {}),
  };
  const sealed = await encryptedEventStreamRequest(httpUrl, endpoint);
  if (!sealed) {
    return {
      url,
      headers: { ...activeLocaleHeaders(), Authorization: `Bearer ${record.token}` },
      seal: null,
    };
  }
  return {
    url,
    headers: { ...activeLocaleHeaders(), ...sealed.headers },
    seal: {
      requestAad: sealed.requestAad,
      requestNonce: sealed.requestNonce,
      material: sealed.material,
    },
  };
}

/** A stored record this device may reach directly: paired, not tunnelled, not the demo. */
function directRecord(serverId: string) {
  const { record, records } = useGatewayConnectionStore.getState();
  const match =
    records.find((entry) => entry.serverId === serverId) ??
    (record?.serverId === serverId ? record : null);
  if (!match || isDemoRecord(match) || match.sshTunnel) return null;
  return match;
}

interface NitroWebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string; isBinary: boolean }) => void) | null;
  onerror: ((error: string) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type NitroWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  headers?: Record<string, string>
) => NitroWebSocketLike;

/**
 * Required, not imported: an OTA bundle can reach a binary built before this
 * native module existed. Missing, it throws here, the socket reports itself
 * unavailable and the workbench stays on SSE.
 */
function nitroWebSocket(): NitroWebSocketConstructor {
  // oxlint-disable-next-line typescript/no-require-imports -- guarded native import, see above
  const module = require('react-native-nitro-websockets') as {
    NitroWebSocket: NitroWebSocketConstructor;
  };
  return module.NitroWebSocket;
}

function openTransport(url: string, headers: Record<string, string>): GatewaySocketTransport {
  const Socket = nitroWebSocket();
  const socket = new Socket(url, undefined, headers);
  const transport: GatewaySocketTransport = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data) => socket.send(data),
    close: (code, reason) => {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(code, reason);
    },
  };
  socket.onopen = () => transport.onopen?.();
  socket.onmessage = (event) => transport.onmessage?.(event);
  socket.onerror = (error) => transport.onerror?.(error);
  socket.onclose = (event) => transport.onclose?.(event);
  return transport;
}

/**
 * `background` is away; `inactive` is not. iOS reports `inactive` for the app
 * switcher, Control Center and the Face ID sheet, and tearing the socket down
 * for those would cost a reconnect and a catch-up for a glance.
 */
const appState = {
  isActive: () => AppState.currentState !== 'background',
  subscribe(listener: (active: boolean) => void) {
    const subscription = AppState.addEventListener('change', (next) =>
      listener(next !== 'background')
    );
    return () => subscription.remove();
  },
};

const sockets = new Map<string, GatewaySocket>();

/** The selected record, when it is one this device may probe directly. */
function probeableSelectedRecord() {
  const record = useGatewayConnectionStore.getState().record;
  if (!record || isDemoRecord(record) || record.sshTunnel) return null;
  return record;
}

/**
 * Whether the gateway still accepts this device, asked through the same
 * `/health` probe the Home dot uses -- so the answer lights the row too, and
 * the store's guards (no probing a tunnelled record's stored address, one
 * flight per server) apply to it.
 */
async function checkAuthorization(serverId: string): Promise<SocketAuthorization> {
  // Any paired computer this device reaches directly: the cards' task sockets
  // are refused the same way the selected one's is.
  const record = directRecord(serverId);
  if (!record) return 'unknown';
  const before = useServerReachability.getState().probes[serverId]?.checkedAtMs;
  await useServerReachability.getState().refresh(record, { force: true });
  return authorizationFromProbe(before, useServerReachability.getState().probes[serverId]);
}

let watchingProbes = false;

/**
 * A computer whose socket stood down as refused, answering a probe after all
 * (re-paired, or the refusal was a middlebox), gets its socket back.
 */
function watchProbesForRecovery(): void {
  if (watchingProbes) return;
  watchingProbes = true;
  useServerReachability.subscribe((state, previous) => {
    for (const [serverId, socket] of sockets) {
      const probe = state.probes[serverId];
      if (!probe?.ok || probe.checkedAtMs === previous.probes[serverId]?.checkedAtMs) continue;
      socket.retryAfterRefusal();
    }
  });
}

/** The one event socket for a paired server, created on first use. */
export function gatewaySocketFor(serverId: string): GatewaySocket {
  let socket = sockets.get(serverId);
  if (!socket) {
    const created = new GatewaySocket({
      prepare: () => prepareUpgrade(serverId),
      open: openTransport,
      crypto: socketFrameCrypto,
      appState,
      onHello: (hello) => noteGatewayGeneration(serverId, hello),
      checkAuthorization: () => checkAuthorization(serverId),
    });
    // The Home dot reads the socket as evidence the computer is answering.
    created.onStateChange((state) => useServerChannels.getState().setSocket(serverId, state));
    sockets.set(serverId, created);
    watchProbesForRecovery();
    socket = created;
  }
  return socket;
}

/**
 * React to the device changing networks: reopen every gateway socket on the
 * new route and ask the selected computer again whether it is there. The
 * terminal stream listens for itself (`use-pane-events`). Started once at the
 * app root; the returned function stops it.
 */
export function startNetworkReactions(): () => void {
  return onNetworkChange(() => {
    for (const socket of sockets.values()) {
      // A refused socket gets one more try per change: a captive portal's 403
      // looked like a revoked pairing, and the new network may not have one.
      if (socket.state === 'unauthorized') socket.retryAfterRefusal();
      else socket.reconnect();
    }
    const record = probeableSelectedRecord();
    if (record) void useServerReachability.getState().refresh(record, { force: true });
  });
}
