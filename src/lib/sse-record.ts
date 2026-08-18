/**
 * Per-event decryption for the gateway's encrypted event stream.
 *
 * The one-envelope response transport cannot authenticate a response that
 * never ends, so an encrypted connection's `/events` stream arrives as
 * standard SSE whose every event is `muqun.encrypted`, carrying one sealed
 * record. This module is the app half of that contract -- the gateway half is
 * `EventStreamSealer` and `transport::derive_stream_key` in muqun-gateway,
 * and the two must agree byte for byte:
 *
 *  - stream key: HKDF-SHA256(device key, salt "muqun-transport-v1",
 *    info "muqun-transport-v1/sse/{sid}/{requestNonce}"). The request nonce
 *    binds the stream to the one request that opened it, so a captured
 *    stream replayed into a later connection derives a different key and
 *    never opens.
 *  - nonce: the record's seq, big-endian, in the low bytes of 12.
 *  - AAD: "{requestAad}\n{sid}\n{seq}".
 *  - plaintext: JSON { event, data } -- the event the plaintext stream would
 *    have carried.
 *
 * Kept pure -- the crypto arrives through {@link SseRecordCrypto} -- so the
 * sequencing and failure rules can run under bun without a native module.
 */

/** The SSE event name every sealed record travels under. */
export const ENCRYPTED_SSE_EVENT = 'muqun.encrypted';

const STREAM_RECORD_VERSION = 1;
const HKDF_SALT = 'muqun-transport-v1';

/** The primitives quick-crypto provides in the app and node provides in tests. */
export interface SseRecordCrypto {
  /** HKDF-SHA256, 32-byte output. */
  hkdf(material: Uint8Array, salt: string, info: string): Uint8Array;
  /**
   * AES-256-GCM open with the 16-byte tag appended to the ciphertext.
   * Must throw on authentication failure.
   */
  open(key: Uint8Array, nonce: Uint8Array, aad: string, sealed: Uint8Array): Uint8Array;
  fromBase64Url(value: string): Uint8Array;
}

/** What one sealed record decrypts to: the event the plain stream would carry. */
export interface DecryptedStreamEvent {
  event: string;
  data: string;
}

/** The record's own sequence number, big-endian in the low bytes of 12. */
export function streamRecordNonce(seq: number): Uint8Array {
  const nonce = new Uint8Array(12);
  let rest = seq;
  for (let index = 11; index >= 4; index -= 1) {
    nonce[index] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return nonce;
}

interface StreamRecord {
  v: number;
  sid: string;
  seq: number;
  ciphertext: string;
}

function parseRecord(data: string): StreamRecord {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error('The server sent an unreadable encrypted event.');
  }
  const record = value as Partial<StreamRecord> | null;
  if (
    !record ||
    record.v !== STREAM_RECORD_VERSION ||
    typeof record.sid !== 'string' ||
    record.sid.length === 0 ||
    typeof record.seq !== 'number' ||
    !Number.isSafeInteger(record.seq) ||
    record.seq < 0 ||
    typeof record.ciphertext !== 'string'
  ) {
    throw new Error('The server sent an invalid encrypted event.');
  }
  return record as StreamRecord;
}

/**
 * Opens one connection's records, in order, and nothing else.
 *
 * Every rule fails closed by throwing, and a throw means the whole stream is
 * poisoned: the caller must drop the connection and reconnect, which already
 * triggers a full refresh. There is no "skip this one record" -- a gap is
 * indistinguishable from deletion, and deletion is an attack.
 */
export class EncryptedEventStreamDecryptor {
  private readonly crypto: SseRecordCrypto;
  private readonly material: Uint8Array;
  private readonly requestAad: string;
  private readonly requestNonce: string;
  private key: Uint8Array | null = null;
  private sid: string | null = null;
  private nextSeq = 0;

  constructor(options: {
    crypto: SseRecordCrypto;
    /** The device transport key material, as `transportKeyMaterial` returns it. */
    material: Uint8Array;
    /** The AAD the stream request was sealed under: "GET {path}?{query}". */
    requestAad: string;
    /** The request envelope's nonce, exactly as transmitted (base64url). */
    requestNonce: string;
  }) {
    this.crypto = options.crypto;
    this.material = options.material;
    this.requestAad = options.requestAad;
    this.requestNonce = options.requestNonce;
  }

  open(data: string): DecryptedStreamEvent {
    const record = parseRecord(data);
    if (this.sid === null) {
      // The first record fixes the stream id for the connection's lifetime; a
      // record from any other stream -- spliced from a second connection, or
      // replayed from an old one -- derives a different key below and fails.
      this.sid = record.sid;
      this.key = this.crypto.hkdf(
        this.material,
        HKDF_SALT,
        `${HKDF_SALT}/sse/${record.sid}/${this.requestNonce}`
      );
    } else if (record.sid !== this.sid) {
      throw new Error('The server switched encrypted streams mid-connection.');
    }
    if (record.seq !== this.nextSeq) {
      // Behind is replay, ahead is deletion; neither is survivable in place.
      throw new Error('The encrypted event stream lost its place.');
    }
    const aad = `${this.requestAad}\n${this.sid}\n${record.seq}`;
    let plaintext: Uint8Array;
    try {
      plaintext = this.crypto.open(
        this.key as Uint8Array,
        streamRecordNonce(record.seq),
        aad,
        this.crypto.fromBase64Url(record.ciphertext)
      );
    } catch {
      throw new Error('The server sent an event that failed authentication.');
    }
    let inner: unknown;
    try {
      inner = JSON.parse(textFromUtf8(plaintext));
    } catch {
      throw new Error('The server sent an unreadable encrypted event.');
    }
    const event = inner as Partial<DecryptedStreamEvent> | null;
    if (!event || typeof event.event !== 'string' || typeof event.data !== 'string') {
      throw new Error('The server sent an invalid encrypted event.');
    }
    this.nextSeq = record.seq + 1;
    return { event: event.event, data: event.data };
  }
}

/**
 * UTF-8 without depending on a TextDecoder global, which Hermes does not
 * ship. The plaintext is gateway-authored JSON, so surrogate handling only
 * has to be correct, not forgiving.
 */
function textFromUtf8(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    let code: number;
    let extra: number;
    if (byte < 0x80) {
      code = byte;
      extra = 0;
    } else if ((byte & 0xe0) === 0xc0) {
      code = byte & 0x1f;
      extra = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      code = byte & 0x0f;
      extra = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      code = byte & 0x07;
      extra = 3;
    } else {
      throw new Error('The server sent an unreadable encrypted event.');
    }
    for (let step = 1; step <= extra; step += 1) {
      const next = bytes[index + step];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        throw new Error('The server sent an unreadable encrypted event.');
      }
      code = (code << 6) | (next & 0x3f);
    }
    index += extra + 1;
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}
