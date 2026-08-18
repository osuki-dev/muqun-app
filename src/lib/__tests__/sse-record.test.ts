import { describe, expect, test } from 'bun:test';
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

import {
  ENCRYPTED_SSE_EVENT,
  EncryptedEventStreamDecryptor,
  streamRecordNonce,
  type SseRecordCrypto,
} from '../sse-record';

/**
 * Plain node primitives standing in for quick-crypto. HKDF is spelled out via
 * HMAC rather than `hkdfSync` so the test pins the construction itself, not a
 * runtime's implementation of it.
 */
function hkdfSha256(ikm: Uint8Array, salt: string, info: string): Uint8Array {
  const prk = createHmac('sha256', Buffer.from(salt, 'utf8')).update(Buffer.from(ikm)).digest();
  const okm = createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(info, 'utf8'), Buffer.from([1])]))
    .digest();
  return new Uint8Array(okm);
}

const testCrypto: SseRecordCrypto = {
  hkdf: (material, salt, info) => hkdfSha256(material, salt, info),
  open(key, nonce, aad, sealed) {
    const ciphertext = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(nonce));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag));
    return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]));
  },
  fromBase64Url: (value) => new Uint8Array(Buffer.from(value, 'base64url')),
};

/** The gateway's `EventStreamSealer`, reproduced for the tests to seal with. */
function sealRecord(
  material: Uint8Array,
  options: {
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
): string {
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
    cipher.update(Buffer.from(JSON.stringify({ event: options.event, data: options.data }), 'utf8')),
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

const material = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const requestAad = 'GET /api/sessions/main/events?types=pane_updated';
const requestNonce = 'req-nonce-fixture';
const sid = 'stream-fixture';

function decryptor(): EncryptedEventStreamDecryptor {
  return new EncryptedEventStreamDecryptor({
    crypto: testCrypto,
    material,
    requestAad,
    requestNonce,
  });
}

function record(seq: number, overrides: Partial<Parameters<typeof sealRecord>[1]> = {}): string {
  return sealRecord(material, {
    sid,
    requestNonce,
    requestAad,
    seq,
    event: 'herdr',
    data: `{"n":${seq}}`,
    ...overrides,
  });
}

describe('the wire fixture shared with the gateway', () => {
  /**
   * The same bytes `transport::tests::stream_event_fixture_matches_the_app_side`
   * asserts on the Rust side. If either implementation drifts -- salt, info
   * shape, nonce layout, AAD -- this is the test that names the disagreement.
   */
  test('opens the ciphertext the gateway test pins', () => {
    const key = testCrypto.hkdf(
      material,
      'muqun-transport-v1',
      `muqun-transport-v1/sse/${sid}/${requestNonce}`
    );
    expect(Buffer.from(key).toString('hex')).toBe(
      'a51b2238d4ddd0f666a9be3b9331691ab542fdeeb24a4ca2ab7c1adab6dc7c63'
    );
    const opened = testCrypto.open(
      key,
      streamRecordNonce(7),
      `${requestAad}\n${sid}\n7`,
      testCrypto.fromBase64Url('0afg46aA-yj6Uts5xXCCNP5EbDcFekXZzFWOTuUoD8vWBTvoYRZrlSBcnLS4VK9g')
    );
    expect(Buffer.from(opened).toString('utf8')).toBe('{"event":"herdr","data":"hello"}');
  });

  test('lays the sequence number out big-endian in the low nonce bytes', () => {
    expect(Array.from(streamRecordNonce(0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(streamRecordNonce(1))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(streamRecordNonce(0x01_02_03_04))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4,
    ]);
    // Above 32 bits, where a bitwise implementation would silently truncate.
    expect(Array.from(streamRecordNonce(2 ** 40 + 5))).toEqual([
      0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 5,
    ]);
  });
});

describe('an honest stream', () => {
  test('opens records in order and hands back the inner events', () => {
    const stream = decryptor();
    expect(stream.open(record(0))).toEqual({ event: 'herdr', data: '{"n":0}' });
    expect(stream.open(record(1))).toEqual({ event: 'herdr', data: '{"n":1}' });
    expect(stream.open(record(2, { event: 'approval.pending', data: '{}' }))).toEqual({
      event: 'approval.pending',
      data: '{}',
    });
  });

  test('survives multi-byte output in the sealed payload', () => {
    const stream = decryptor();
    const opened = stream.open(record(0, { data: '⏺ 日本語 → done ✅' }));
    expect(opened.data).toBe('⏺ 日本語 → done ✅');
  });
});

describe('a hostile or torn stream fails closed', () => {
  test('rejects a tampered record', () => {
    const stream = decryptor();
    const parsed = JSON.parse(record(0)) as { ciphertext: string };
    const flipped = (parsed.ciphertext[0] === 'A' ? 'B' : 'A') + parsed.ciphertext.slice(1);
    expect(() => stream.open(JSON.stringify({ ...parsed, ciphertext: flipped }))).toThrow(
      'failed authentication'
    );
  });

  test('rejects a replayed record', () => {
    const stream = decryptor();
    const first = record(0);
    stream.open(first);
    expect(() => stream.open(first)).toThrow('lost its place');
  });

  test('rejects a gap, which is indistinguishable from deletion', () => {
    const stream = decryptor();
    stream.open(record(0));
    expect(() => stream.open(record(2))).toThrow('lost its place');
  });

  test('rejects a record renumbered to fill the slot it was moved to', () => {
    const stream = decryptor();
    stream.open(record(0));
    // Sealed as seq 2, relabeled as seq 1: nonce and AAD both disagree.
    const moved = JSON.parse(record(2)) as { ciphertext: string };
    const renumbered = JSON.stringify({ v: 1, sid, seq: 1, ciphertext: moved.ciphertext });
    expect(() => stream.open(renumbered)).toThrow('failed authentication');
  });

  test('rejects a switch to another stream id mid-connection', () => {
    const stream = decryptor();
    stream.open(record(0));
    expect(() => stream.open(record(1, { sid: 'other-stream' }))).toThrow(
      'switched encrypted streams'
    );
  });

  test('rejects a stream recorded from an earlier connection', () => {
    // Sealed for a request whose envelope nonce differs -- a bytes-for-bytes
    // replay of a captured stream into this connection.
    const replayed = sealRecord(material, {
      sid,
      requestNonce: 'a-previous-request',
      requestAad,
      seq: 0,
      event: 'herdr',
      data: '{}',
    });
    expect(() => decryptor().open(replayed)).toThrow('failed authentication');
  });

  test('rejects malformed and mis-versioned records', () => {
    const stream = decryptor();
    expect(() => stream.open('not json')).toThrow('unreadable');
    expect(() => stream.open(JSON.stringify({ v: 2, sid, seq: 0, ciphertext: 'AA' }))).toThrow(
      'invalid'
    );
    expect(() => stream.open(JSON.stringify({ v: 1, sid, seq: -1, ciphertext: 'AA' }))).toThrow(
      'invalid'
    );
    expect(() => stream.open(JSON.stringify({ v: 1, sid: '', seq: 0, ciphertext: 'AA' }))).toThrow(
      'invalid'
    );
  });

  test('rejects an inner payload that is not an event', () => {
    const stream = decryptor();
    const key = hkdfSha256(
      material,
      'muqun-transport-v1',
      `muqun-transport-v1/sse/${sid}/${requestNonce}`
    );
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(streamRecordNonce(0)));
    cipher.setAAD(Buffer.from(`${requestAad}\n${sid}\n0`, 'utf8'));
    const sealed = Buffer.concat([
      cipher.update(Buffer.from('{"not":"an event"}', 'utf8')),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    expect(() =>
      stream.open(
        JSON.stringify({ v: 1, sid, seq: 0, ciphertext: sealed.toString('base64url') })
      )
    ).toThrow('invalid');
  });

  test('a failed record consumes no sequence slot; tearing down is the caller\'s job', () => {
    const stream = decryptor();
    stream.open(record(0));
    expect(() => stream.open(record(2))).toThrow();
    // The honest successor still opens: nothing was consumed by the failure.
    expect(stream.open(record(1))).toEqual({ event: 'herdr', data: '{"n":1}' });
  });
});

test('the encrypted event name matches what the gateway emits', () => {
  expect(ENCRYPTED_SSE_EVENT).toBe('muqun.encrypted');
});
