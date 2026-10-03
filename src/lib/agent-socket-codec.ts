/**
 * The frames of the gateway's event WebSocket (`GET /api/ws`), sealed and not.
 *
 * The app half of `agents/ws_routes.rs` (`FrameCodec`) and
 * `transport::derive_ws_server_key` / `derive_ws_client_key` in muqun-gateway;
 * the two must agree byte for byte:
 *
 *  - keys: HKDF-SHA256(device key, salt "muqun-transport-v1"), 32 bytes, info
 *    "muqun-transport-v1/ws/{connectionId}/{requestNonce}" for server frames
 *    and "muqun-transport-v1/ws-client/{connectionId}/{requestNonce}" for the
 *    client's. `requestNonce` is the upgrade envelope's nonce as sent.
 *  - nonce: the frame's seq, big-endian in the low eight of twelve bytes (the
 *    SSE record's layout). Each direction counts its own seq from 0.
 *  - AAD: "{requestAad}\n{connectionId}\n{seq}".
 *  - wire: `{"seq":0,"cid":"…","c":"…"}` for the first server frame (the id is
 *    needed to derive the key that opens it), `{"seq":n,"c":"…"}` after.
 *
 * Pure -- the cipher arrives through {@link SocketFrameCrypto} -- so the
 * sequencing and failure rules run under bun without a native module.
 */
import { parseAgentDomainEvent, type AgentDomainEvent } from './agent-protocol';
import { streamRecordNonce } from './sse-record';

export const AGENT_SOCKET_PATH = '/api/ws';
/** The frame vocabulary this build speaks; `hello` must name the same. */
export const AGENT_SOCKET_PROTOCOL = 1;

const HKDF_SALT = 'muqun-transport-v1';

/** What quick-crypto provides in the app and node provides in the tests. */
export interface SocketFrameCrypto {
  /** HKDF-SHA256, 32-byte output. */
  hkdf(material: Uint8Array, salt: string, info: string): Uint8Array;
  /** AES-256-GCM over UTF-8 text; base64url (no padding) ciphertext with the tag appended. */
  seal(key: Uint8Array, nonce: Uint8Array, aad: string, plaintext: string): string;
  /** The inverse of `seal`. Must throw on authentication failure. */
  open(key: Uint8Array, nonce: Uint8Array, aad: string, ciphertext: string): string;
}

/** A frame the socket cannot carry on from. The connection is closed and reopened. */
export class AgentSocketProtocolError extends Error {
  override name = 'AgentSocketProtocolError';
}

export interface AgentSocketKeys {
  server: Uint8Array;
  client: Uint8Array;
}

export function deriveAgentSocketKeys(
  crypto: SocketFrameCrypto,
  material: Uint8Array,
  connectionId: string,
  requestNonce: string
): AgentSocketKeys {
  return {
    server: crypto.hkdf(material, HKDF_SALT, `${HKDF_SALT}/ws/${connectionId}/${requestNonce}`),
    client: crypto.hkdf(
      material,
      HKDF_SALT,
      `${HKDF_SALT}/ws-client/${connectionId}/${requestNonce}`
    ),
  };
}

export function agentSocketFrameAad(requestAad: string, connectionId: string, seq: number): string {
  return `${requestAad}\n${connectionId}\n${seq}`;
}

/** Turns wire text into plaintext frames and back, for one connection. */
export interface AgentSocketCodec {
  /** The plaintext of one server message. Throws when the connection is poisoned. */
  openServer(wire: string): string;
  /** The wire text of one client frame. Throws before the connection id is known. */
  sealClient(plaintext: string): string;
  /** The id the first sealed frame named; null on a plaintext connection. */
  readonly connectionId: string | null;
}

/** A device paired without a transport key: every frame is its own plaintext. */
export class PlainAgentSocketCodec implements AgentSocketCodec {
  readonly connectionId = null;
  openServer(wire: string): string {
    return wire;
  }
  sealClient(plaintext: string): string {
    return plaintext;
  }
}

interface SealedWireFrame {
  seq: number;
  cid?: string;
  c: string;
}

function parseSealedWire(wire: string): SealedWireFrame {
  let value: unknown;
  try {
    value = JSON.parse(wire);
  } catch {
    throw new AgentSocketProtocolError('The server sent an unreadable socket frame.');
  }
  const frame = value as Partial<SealedWireFrame> | null;
  if (
    !frame ||
    typeof frame !== 'object' ||
    typeof frame.seq !== 'number' ||
    !Number.isSafeInteger(frame.seq) ||
    frame.seq < 0 ||
    typeof frame.c !== 'string' ||
    (frame.cid !== undefined && typeof frame.cid !== 'string')
  ) {
    // Includes a plaintext frame on a sealed connection: fail closed.
    throw new AgentSocketProtocolError('The server sent a socket frame that is not sealed.');
  }
  return frame as SealedWireFrame;
}

/**
 * One encrypted connection's two directions.
 *
 * Every rule fails closed by throwing, and a throw poisons the connection: a
 * gap is indistinguishable from deletion, and a repeat from replay.
 */
export class SealedAgentSocketCodec implements AgentSocketCodec {
  private readonly crypto: SocketFrameCrypto;
  private readonly material: Uint8Array;
  private readonly requestAad: string;
  private readonly requestNonce: string;
  private keys: AgentSocketKeys | null = null;
  private cid: string | null = null;
  private nextServerSeq = 0;
  private nextClientSeq = 0;

  constructor(options: {
    crypto: SocketFrameCrypto;
    /** The device transport key material. */
    material: Uint8Array;
    /** The AAD the upgrade was sealed under: "GET /api/ws". */
    requestAad: string;
    /** The upgrade envelope's nonce, exactly as transmitted (base64url). */
    requestNonce: string;
  }) {
    this.crypto = options.crypto;
    this.material = options.material;
    this.requestAad = options.requestAad;
    this.requestNonce = options.requestNonce;
  }

  get connectionId(): string | null {
    return this.cid;
  }

  openServer(wire: string): string {
    const frame = parseSealedWire(wire);
    if (frame.seq !== this.nextServerSeq) {
      throw new AgentSocketProtocolError('The event socket lost its place.');
    }
    if (this.keys === null) {
      // The first frame names the connection; the key that opens it derives
      // from that name, so a frame spliced from another connection fails.
      if (!frame.cid) {
        throw new AgentSocketProtocolError('The first socket frame did not name its connection.');
      }
      this.cid = frame.cid;
      this.keys = deriveAgentSocketKeys(this.crypto, this.material, frame.cid, this.requestNonce);
    }
    let plaintext: string;
    try {
      plaintext = this.crypto.open(
        this.keys.server,
        streamRecordNonce(frame.seq),
        agentSocketFrameAad(this.requestAad, this.cid as string, frame.seq),
        frame.c
      );
    } catch {
      throw new AgentSocketProtocolError('A socket frame failed authentication.');
    }
    this.nextServerSeq = frame.seq + 1;
    return plaintext;
  }

  sealClient(plaintext: string): string {
    if (this.keys === null || this.cid === null) {
      throw new AgentSocketProtocolError('The socket cannot send before the server said hello.');
    }
    const seq = this.nextClientSeq;
    const c = this.crypto.seal(
      this.keys.client,
      streamRecordNonce(seq),
      agentSocketFrameAad(this.requestAad, this.cid, seq),
      plaintext
    );
    this.nextClientSeq = seq + 1;
    return JSON.stringify({ seq, c });
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export type AgentSocketServerFrame =
  | { t: 'hello'; connectionId: string; protocol: number }
  | { t: 'subscribed'; asid: string }
  | { t: 'subscribed'; all: true }
  /** `event` already parsed; null when this build has no branch for it. */
  | { t: 'event'; asid: string; seq: number; event: AgentDomainEvent | null }
  /** `asid` "" means every session. */
  | { t: 'resync'; asid: string }
  | { t: 'pong' }
  | { t: 'error'; code: string };

export type AgentSocketClientFrame =
  | { t: 'subscribe'; asid: string }
  | { t: 'unsubscribe'; asid: string }
  | { t: 'subscribe_all' }
  | { t: 'ping' };

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * One plaintext server frame, or null for a frame this build does not know --
 * the vocabulary may grow; an older App ignores what it cannot read. A frame
 * that is not JSON at all is a broken connection and throws.
 */
export function parseAgentSocketFrame(plaintext: string): AgentSocketServerFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new AgentSocketProtocolError('The server sent an unreadable socket frame.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  switch (rec.t) {
    case 'hello': {
      const connectionId = str(rec.connection_id);
      if (!connectionId || typeof rec.protocol !== 'number') return null;
      return { t: 'hello', connectionId, protocol: rec.protocol };
    }
    case 'subscribed': {
      if (rec.all === true) return { t: 'subscribed', all: true };
      const asid = str(rec.asid);
      return asid ? { t: 'subscribed', asid } : null;
    }
    case 'event': {
      const asid = str(rec.asid);
      const name = str(rec.event);
      if (asid === null || name === null) return null;
      const seq = typeof rec.seq === 'number' && Number.isFinite(rec.seq) ? rec.seq : 0;
      // `data` is the SSE `data:` payload embedded as JSON; the parser the SSE
      // path uses takes it from here unchanged.
      return { t: 'event', asid, seq, event: parseAgentDomainEvent(name, rec.data) };
    }
    case 'resync': {
      const asid = str(rec.asid);
      return asid === null ? null : { t: 'resync', asid };
    }
    case 'pong':
      return { t: 'pong' };
    case 'error': {
      return { t: 'error', code: str(rec.code) ?? 'unknown' };
    }
    default:
      return null;
  }
}

export function serializeAgentSocketFrame(frame: AgentSocketClientFrame): string {
  return JSON.stringify(frame);
}
