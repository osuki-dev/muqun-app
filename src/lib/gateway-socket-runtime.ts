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
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';

import type { SocketFrameCrypto } from './agent-socket-codec';
import { isDemoActive } from './demo-gateway';
import {
  configuredGatewayServerId,
  encryptedEventStreamRequest,
  gatewayAuthHeaders,
  gatewayUrl,
  isGatewayConfigured,
} from './gateway-client';
import {
  GatewaySocket,
  gatewaySocketPath,
  type GatewaySocketTransport,
  type GatewaySocketUpgrade,
} from './gateway-socket';
import { streamRecordCrypto } from './gateway-transport';

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
function prepareUpgrade(serverId: string): GatewaySocketUpgrade | null {
  if (isDemoActive() || !isGatewayConfigured()) return null;
  if (configuredGatewayServerId() !== serverId) return null;
  // Read per attempt, so a reconnect follows a discovery answered since.
  const path = gatewaySocketPath(mirroredDiscoveryFor(serverId)?.transports);
  if (!path) return null;
  const httpUrl = gatewayUrl(path);
  const url = httpUrl.replace(/^http(s?):\/\//i, (_, secure: string) => `ws${secure}://`);
  if (!/^wss?:\/\//i.test(url)) return null;
  // The AAD is path-only, so sealing against the http spelling is the same
  // request the gateway sees.
  const sealed = encryptedEventStreamRequest(httpUrl);
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

/** The one event socket for a paired server, created on first use. */
export function gatewaySocketFor(serverId: string): GatewaySocket {
  let socket = sockets.get(serverId);
  if (!socket) {
    socket = new GatewaySocket({
      prepare: () => prepareUpgrade(serverId),
      open: openTransport,
      crypto: socketFrameCrypto,
      appState,
      onHello: (hello) => noteGatewayGeneration(serverId, hello),
    });
    sockets.set(serverId, socket);
  }
  return socket;
}
