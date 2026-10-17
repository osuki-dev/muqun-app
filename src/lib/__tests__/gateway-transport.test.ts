import { expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import type * as Transport from '../gateway-transport';

// Execute the actual production codec with real AES-GCM, isolating only the
// native package import so process-wide module mocks cannot alter these tests.
const source = readFileSync('src/lib/gateway-transport.ts', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport /g, '');
const codec = runInNewContext(
  transpile(
    `${source}\n({encryptBytes, decryptBytes, encryptJson, decryptJson, transportKeyMaterial})`
  ),
  {
    QuickCrypto: { ...crypto, Buffer },
    Date,
    Uint8Array,
  }
) as Pick<
  typeof Transport,
  'encryptBytes' | 'decryptBytes' | 'encryptJson' | 'decryptJson' | 'transportKeyMaterial'
>;
const key = new Uint8Array(32).fill(7);
const text = Buffer.from('defensive fixture');
const aad = 'POST /api/tasks?kind=command';

test('v1 remains readable and v2 binds its timestamp and existing request AAD', () => {
  for (const version of [1, 2] as const) {
    const envelope = codec.encryptBytes(key, 'request', aad, text, Date.now(), version);
    expect(codec.decryptBytes(key, 'request', aad, envelope, version).toString()).toBe(
      text.toString()
    );
  }
  const v2 = codec.encryptBytes(key, 'request', aad, text, Date.now(), 2);
  expect(() =>
    codec.decryptBytes(key, 'request', aad, { ...v2, timestamp_ms: v2.timestamp_ms + 1 }, 2)
  ).toThrow();
  expect(() => codec.decryptBytes(key, 'request', 'POST /api/other', v2, 2)).toThrow();
  expect(() => codec.decryptBytes(key, 'response', aad, v2, 2)).toThrow();
});

test('version tampering and a v1 response to a v2 request are rejected', () => {
  const v2 = codec.encryptBytes(key, 'response', `${aad}\nnonce`, text, Date.now(), 2);
  expect(() =>
    codec.decryptBytes(key, 'response', `${aad}\nnonce`, { ...v2, version: 1 }, 2)
  ).toThrow();
  expect(() =>
    codec.decryptBytes(key, 'response', `${aad}\nnonce`, { ...v2, version: 1 }, 1)
  ).toThrow();
  const v1 = codec.encryptBytes(key, 'response', `${aad}\nnonce`, text);
  expect(() => codec.decryptBytes(key, 'response', `${aad}\nnonce`, v1, 2)).toThrow();
  expect(() => codec.decryptBytes(key, 'response', `${aad}\nanother`, v2, 2)).toThrow();
});

test('nonce and ciphertext must use canonical unpadded base64url', () => {
  const envelope = codec.encryptBytes(key, 'response', aad, text, Date.now(), 2);
  for (const nonce of [envelope.nonce + '=', envelope.nonce + '\n', ' ' + envelope.nonce]) {
    expect(() => codec.decryptBytes(key, 'response', aad, { ...envelope, nonce }, 2)).toThrow();
  }
  expect(() =>
    codec.decryptBytes(
      key,
      'response',
      aad,
      { ...envelope, ciphertext: envelope.ciphertext + '=' },
      2
    )
  ).toThrow();
});

test('expired and noninteger timestamps are rejected', () => {
  const old = codec.encryptBytes(key, 'response', aad, text, Date.now() - 600_000, 2);
  expect(() => codec.decryptBytes(key, 'response', aad, old, 2)).toThrow();
  expect(() => codec.encryptBytes(key, 'response', aad, text, 1.2, 2)).toThrow();
});

function requestHarness(responseVersion: 1 | 2 = 2) {
  const calls: { method: string; request: Transport.EncryptedEnvelope }[] = [];
  const endpoint = {
    url: 'https://fixture.invalid',
    token: 'fixture-token',
    deviceId: 'fixture-device',
    transportKey: Buffer.from(key).toString('base64url'),
    transport: 'muqun-aes-256-gcm-v1',
  };
  const functions = [
    'requestUrl',
    'requestAad',
    'base64Url',
    'fromBase64Url',
    'sendEncryptedGatewayRequest',
    'encryptedEventStreamRequest',
  ]
    .map((name) => declaration('src/lib/gateway-client.ts', name))
    .join('\n');
  const api = runInNewContext(
    transpile(`${functions}\n({sendEncryptedGatewayRequest, encryptedEventStreamRequest})`),
    {
      ...codec,
      URL,
      Date,
      Response,
      QuickCrypto: { ...crypto, Buffer },
      GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
      REQUEST_TIMEOUT_MS: 1000,
      ENVELOPE_ACCEPT_HEADER: 'X-Muqun-Envelope-Accept',
      ENVELOPE_ACCEPT_ENCODINGS: 'gzip',
      isStreamingRequest: () => false,
      // The pairing-fault bookkeeping; what it records is another suite's.
      noteAccepted: () => {},
      noteRefusal: () => {},
      headerRecord: (headers: unknown) => ({ ...(headers as Record<string, string>) }),
      serializeBody: async (body: string) => ({
        bytes: Buffer.from(body ?? ''),
        contentType: 'application/json',
      }),
      assertDeliveryCurrent: (isCurrent: () => boolean) => {
        if (!isCurrent()) throw new Error('cancelled');
      },
      negotiatedTransportVersion: async () => 2,
      decodeSealedBody: (bytes: Uint8Array) => ({
        bytes,
        headers: { 'content-type': 'application/json' },
      }),
      answerHasNoBody: () => false,
      NitroResponse: Response,
      fetchWithin: async (_budget: number, _message: string, target: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        expect(headers['X-Muqun-Transport']).toBe('1');
        const request = JSON.parse(
          init.body
            ? String(init.body)
            : Buffer.from(headers['X-Muqun-Envelope'], 'base64url').toString()
        ) as Transport.EncryptedEnvelope;
        calls.push({ method: init.method!, request });
        expect(request.version).toBe(2);
        const url = new URL(target);
        const requestAad = `${init.method} ${url.pathname}${url.search}`;
        const plaintext = codec.decryptJson<{ token: string }>(
          key,
          'request',
          requestAad,
          request,
          2
        );
        expect(plaintext.token).toBe(endpoint.token);
        const response = codec.encryptJson(
          key,
          'response',
          `${requestAad}\n${request.nonce}`,
          {
            status: 200,
            headers: {},
            body: Buffer.from('{"ok":true}').toString('base64url'),
          },
          responseVersion
        );
        return new Response(JSON.stringify(response), { headers: { 'x-muqun-transport': '1' } });
      },
    }
  ) as {
    sendEncryptedGatewayRequest: (
      url: string,
      init: RequestInit,
      budget: number,
      endpoint: unknown
    ) => Promise<Response>;
    encryptedEventStreamRequest: (
      url: string,
      endpoint: unknown
    ) => Promise<{ headers: Record<string, string> }>;
  };
  return { api, endpoint, calls };
}

test('HTTP writes and reads send negotiated v2 without changing the transport marker', async () => {
  const h = requestHarness();
  for (const method of ['POST', 'GET']) {
    const response = await h.api.sendEncryptedGatewayRequest(
      `${h.endpoint.url}/api/tasks?kind=command`,
      {
        method,
        headers: { Authorization: 'Bearer fixture-token' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      },
      1000,
      h.endpoint
    );
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(h.calls.map((call) => call.method)).toEqual(['POST', 'GET']);
});

test('a downgraded response to a write fails without retrying the write', async () => {
  const h = requestHarness(1);
  await expect(
    h.api.sendEncryptedGatewayRequest(
      `${h.endpoint.url}/api/tasks`,
      { method: 'POST', body: '{}' },
      1000,
      h.endpoint
    )
  ).rejects.toThrow('unsupported encryption version');
  expect(h.calls).toHaveLength(1);
});

test('SSE and WebSocket upgrade envelopes use v2 with the unchanged stream AAD', async () => {
  const h = requestHarness();
  for (const path of ['/api/ws', '/api/sessions/example/events']) {
    const request = await h.api.encryptedEventStreamRequest(`${h.endpoint.url}${path}`, h.endpoint);
    const envelope = JSON.parse(
      Buffer.from(request.headers['X-Muqun-Envelope'], 'base64url').toString()
    ) as Transport.EncryptedEnvelope;
    expect(envelope.version).toBe(2);
    expect(request.headers['X-Muqun-Transport']).toBe('1');
    expect(
      codec.decryptJson<{ token: string }>(key, 'request', `GET ${path}`, envelope, 2).token
    ).toBe(h.endpoint.token);
  }
});

test('the shared Gateway v2 interoperability fixture decrypts byte for byte', () => {
  const fixed = runInNewContext(transpile(`${source}\n({decryptJson})`), {
    QuickCrypto: { ...crypto, Buffer },
    Date: { now: () => 1_700_000_000_000 },
    Uint8Array,
  }) as Pick<typeof Transport, 'decryptJson'>;
  const material = Buffer.from('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', 'base64url');
  expect(
    fixed.decryptJson(
      material,
      'request',
      'GET /health',
      {
        version: 2,
        timestamp_ms: 1_700_000_000_000,
        nonce: 'CwwNDg8QERITFBUW',
        ciphertext: 'JjVMzuXR1pmBl4rHrkekRD_tm8rxctorFn0Uwpp3f39AzhRBTjuS-3emocypEWjn-ZAd',
      },
      2
    )
  ).toEqual({ token: 'fixture-token', body: '' });
});
