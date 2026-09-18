/**
 * The gateway's `EventStreamSealer`, reproduced so the app side can be tested
 * against records it did not itself produce.
 *
 * Shared rather than copied because two suites need it now -- the decryptor's
 * own (`sse-record.test.ts`) and the agent stream's (`agent-session-stream`),
 * which proves the transport routes an encrypted pairing through this format
 * at all. Two copies of a security fixture drift, and a drifted copy is a test
 * that passes while agreeing with nothing.
 *
 * HKDF is spelled out via HMAC rather than `hkdfSync` on purpose: the test
 * pins the construction itself, not a runtime's implementation of it.
 */
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

import { streamRecordNonce, type SseRecordCrypto } from '../sse-record';

export function hkdfSha256(ikm: Uint8Array, salt: string, info: string): Uint8Array {
  const prk = createHmac('sha256', Buffer.from(salt, 'utf8')).update(Buffer.from(ikm)).digest();
  const okm = createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(info, 'utf8'), Buffer.from([1])]))
    .digest();
  return new Uint8Array(okm);
}

/** Plain node primitives standing in for quick-crypto. */
export const testCrypto: SseRecordCrypto = {
  hkdf: (material, salt, info) => hkdfSha256(material, salt, info),
  open(key, nonce, aad, sealed) {
    const ciphertext = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag));
    return new Uint8Array(
      Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()])
    );
  },
  fromBase64Url: (value) => new Uint8Array(Buffer.from(value, 'base64url')),
};

export interface SealRecordOptions {
  sid: string;
  requestNonce: string;
  requestAad: string;
  seq: number;
  event: string;
  data: string;
  /** Overrides for hostile records; defaults spell the honest gateway. */
  aad?: string;
  nonceSeq?: number;
}

/** One record's `data:` line, exactly as `EventStreamSealer::seal_record` writes it. */
export function sealRecord(material: Uint8Array, options: SealRecordOptions): string {
  const key = hkdfSha256(
    material,
    'muqun-transport-v1',
    `muqun-transport-v1/sse/${options.sid}/${options.requestNonce}`
  );
  const aad = options.aad ?? `${options.requestAad}\n${options.sid}\n${options.seq}`;
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key),
    Buffer.from(streamRecordNonce(options.nonceSeq ?? options.seq))
  );
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const sealed = Buffer.concat([
    cipher.update(
      Buffer.from(JSON.stringify({ event: options.event, data: options.data }), 'utf8')
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return JSON.stringify({
    v: 1,
    sid: options.sid,
    seq: options.seq,
    ciphertext: sealed.toString('base64url'),
  });
}
