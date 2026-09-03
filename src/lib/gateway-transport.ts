import QuickCrypto from 'react-native-quick-crypto';

import type { SseRecordCrypto } from './sse-record';

export const GATEWAY_TRANSPORT = 'muqun-aes-256-gcm-v1' as const;
export const GATEWAY_TRANSPORT_VERSION = 1 as const;
const TAG_BYTES = 16;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The AAD a manually-paired claim response is sealed under. It has no request
 * nonce to bind to -- there is no encrypted request, only an unencrypted one
 * authenticated by the pairing code -- so it is a fixed string instead. Must
 * match the gateway's `code_pairing_response` exactly.
 */
export const CODE_PAIRING_CLAIM_AAD = 'POST /api/pair/claim\ncode-pairing\n';

/** Argon2id parameters. Must match the gateway's `CODE_KDF_*` constants. */
const CODE_KDF_MEMORY_KIB = 19_456;
const CODE_KDF_TIME_COST = 2;
const CODE_KDF_PARALLELISM = 1;
const CODE_KDF_OUTPUT_LEN = 32;

export type TransportDirection = 'request' | 'response' | 'pairing-request' | 'pairing-response';

export interface EncryptedEnvelope {
  version: 1;
  timestamp_ms: number;
  nonce: string;
  ciphertext: string;
}

function fromBase64Url(value: string) {
  return QuickCrypto.Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function toBase64Url(value: Uint8Array): string {
  return QuickCrypto.Buffer.from(value).toString('base64url');
}

function directionKey(material: Uint8Array, direction: TransportDirection) {
  return QuickCrypto.Buffer.from(
    QuickCrypto.hkdfSync(
      'sha256',
      QuickCrypto.Buffer.from(material),
      QuickCrypto.Buffer.from('muqun-transport-v1', 'utf8'),
      QuickCrypto.Buffer.from(`muqun-transport-v1/${direction}`, 'utf8'),
      32
    )
  );
}

export function transportKeyMaterial(encoded: string) {
  const key = fromBase64Url(encoded);
  if (key.length !== 32) throw new Error('Gateway contains an invalid encryption key.');
  return key;
}

export const pairingKeyMaterial = transportKeyMaterial;

export function encryptBytes(
  material: Uint8Array,
  direction: TransportDirection,
  aad: string,
  plaintext: Uint8Array,
  timestampMs = Date.now()
): EncryptedEnvelope {
  const nonce = QuickCrypto.randomBytes(12);
  const cipher = QuickCrypto.createCipheriv(
    'aes-256-gcm',
    directionKey(material, direction),
    nonce
  );
  cipher.setAAD(QuickCrypto.Buffer.from(aad, 'utf8'));
  const ciphertext = QuickCrypto.Buffer.concat([
    cipher.update(QuickCrypto.Buffer.from(plaintext)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    version: GATEWAY_TRANSPORT_VERSION,
    timestamp_ms: timestampMs,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(ciphertext),
  };
}

export function decryptBytes(
  material: Uint8Array,
  direction: TransportDirection,
  aad: string,
  envelope: EncryptedEnvelope
) {
  if (envelope.version !== GATEWAY_TRANSPORT_VERSION) {
    throw new Error('Gateway uses an unsupported encryption version.');
  }
  if (
    !Number.isSafeInteger(envelope.timestamp_ms) ||
    Math.abs(Date.now() - envelope.timestamp_ms) > MAX_CLOCK_SKEW_MS
  ) {
    throw new Error('Gateway returned an expired encrypted response.');
  }
  const nonce = fromBase64Url(envelope.nonce);
  const sealed = fromBase64Url(envelope.ciphertext);
  if (nonce.length !== 12 || sealed.length < TAG_BYTES) {
    throw new Error('Gateway returned an invalid encrypted response.');
  }
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const decipher = QuickCrypto.createDecipheriv(
    'aes-256-gcm',
    directionKey(material, direction),
    nonce
  );
  decipher.setAAD(QuickCrypto.Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return QuickCrypto.Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptJson(
  material: Uint8Array,
  direction: TransportDirection,
  aad: string,
  value: unknown
): EncryptedEnvelope {
  return encryptBytes(
    material,
    direction,
    aad,
    QuickCrypto.Buffer.from(JSON.stringify(value), 'utf8')
  );
}

export function decryptJson<T>(
  material: Uint8Array,
  direction: TransportDirection,
  aad: string,
  envelope: EncryptedEnvelope
): T {
  return JSON.parse(decryptBytes(material, direction, aad, envelope).toString('utf8')) as T;
}

/**
 * The primitives `EncryptedEventStreamDecryptor` runs on, provided by
 * quick-crypto here and by node's crypto in the bun tests. The decryptor owns
 * the contract -- key info string, nonce layout, AAD -- and this only owns
 * the cipher calls, so the part that has to match the gateway byte for byte
 * stays in the module that can be tested without a native runtime.
 */
export const streamRecordCrypto: SseRecordCrypto = {
  hkdf(material, salt, info) {
    return new Uint8Array(
      QuickCrypto.hkdfSync(
        'sha256',
        QuickCrypto.Buffer.from(material),
        QuickCrypto.Buffer.from(salt, 'utf8'),
        QuickCrypto.Buffer.from(info, 'utf8'),
        32
      )
    );
  },
  open(key, nonce, aad, sealed) {
    if (sealed.length < TAG_BYTES) {
      throw new Error('The server sent an invalid encrypted event.');
    }
    const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
    const tag = sealed.subarray(sealed.length - TAG_BYTES);
    const decipher = QuickCrypto.createDecipheriv(
      'aes-256-gcm',
      QuickCrypto.Buffer.from(key),
      QuickCrypto.Buffer.from(nonce)
    );
    decipher.setAAD(QuickCrypto.Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(QuickCrypto.Buffer.from(tag));
    return new Uint8Array(
      QuickCrypto.Buffer.concat([
        decipher.update(QuickCrypto.Buffer.from(ciphertext)),
        decipher.final(),
      ])
    );
  },
  fromBase64Url(value) {
    return new Uint8Array(fromBase64Url(value));
  },
};

/**
 * The transport key material a manually-paired claim stands in for a QR's
 * pre-shared key, derived from the one-time pairing code instead of scanned
 * off a screen.
 *
 * A code a person reads and types has far less entropy than the QR's 256
 * random bits -- eight characters from a 32-symbol alphabet, about 40 bits.
 * Argon2id closes most of that gap: it is deliberately expensive to compute,
 * so an eavesdropper who captured the sealed claim response cannot test
 * candidate codes at hash speed the way a bare HKDF would let them. See
 * `code_pairing_material` on the gateway, which this must match exactly --
 * same algorithm, same cost parameters, same salt derivation -- or the two
 * sides derive different keys and the response never opens.
 */
export async function codePairingMaterial(code: string, requestId: string): Promise<Uint8Array> {
  const salt = QuickCrypto.createHash('sha256')
    .update(QuickCrypto.Buffer.from('muqun-pairing-code-salt-v1', 'utf8'))
    .update(QuickCrypto.Buffer.from(requestId, 'utf8'))
    .digest();
  return new Promise<Uint8Array>((resolve, reject) => {
    QuickCrypto.argon2(
      'argon2id',
      {
        message: QuickCrypto.Buffer.from(code, 'utf8'),
        nonce: salt,
        parallelism: CODE_KDF_PARALLELISM,
        tagLength: CODE_KDF_OUTPUT_LEN,
        memory: CODE_KDF_MEMORY_KIB,
        passes: CODE_KDF_TIME_COST,
      },
      (err, result) => (err ? reject(err) : resolve(new Uint8Array(result)))
    );
  });
}
