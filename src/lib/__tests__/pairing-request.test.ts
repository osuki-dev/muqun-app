import { expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import type * as Gateway from '../gateway-client';
import type { GatewayRecord, GatewaySshTunnel } from '../gateway-storage';
import type * as Transport from '../gateway-transport';
import type * as Transaction from '../pairing-transaction';
import {
  validateClaimedPairing,
  validatePairingTransport,
  validateServerId,
  type PairingPayload,
} from '../pairing';
import {
  answerHasNoBody,
  headerRecord,
  isStreamingRequest,
  startRequestBudget,
  withBodyDeadline,
} from '../request-budget';

// Execute the real codec and request path without importing native modules or
// installing process-wide mocks that could change another suite's transport.
const codecSource = readFileSync('src/lib/gateway-transport.ts', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport /g, '');
const codec = runInNewContext(
  transpile(`${codecSource}\n({encryptJson, decryptJson, pairingKeyMaterial})`),
  { QuickCrypto: { ...crypto, Buffer }, Date, Uint8Array }
) as Pick<typeof Transport, 'encryptJson' | 'decryptJson' | 'pairingKeyMaterial'>;
const key = Buffer.alloc(32, 7);
const bootstrapKey = key.toString('base64url');
const oldToken = 'previously-paired-gateway-token';
const codeAad = 'POST /api/pair/claim\ncode-pairing\n';
const payload: PairingPayload = {
  kind: 'muqun-gateway',
  server_id: 'new-server',
  label: 'New computer',
  url: 'https://new-gateway.invalid',
  token: 't'.repeat(43),
};
const savedRecord: GatewayRecord = {
  serverId: payload.server_id,
  label: payload.label,
  url: payload.url,
  token: payload.token,
  deviceId: undefined,
  transportKey: undefined,
  transport: undefined,
  pairedAt: 1700000000000,
};
const requestResponse: Gateway.PairingRequestResponse = {
  request_id: 'request-1',
  server_id: 'new-server',
  server_label: 'New computer',
  status: 'pending',
};
const gatewaySource = [
  'fetchWithin',
  'sendGatewayRequest',
  'looksLikeEncryptedEnvelope',
  'pairingRequest',
  'requestPairing',
  'claimPairing',
]
  .map((name) => declaration('src/lib/gateway-client.ts', name))
  .join('\n');
const transactionSource = ['beginPairingTransaction', 'claimPairingTransaction']
  .map((name) => declaration('src/lib/pairing-transaction.ts', name))
  .join('\n');

type NetworkCall = { url: string; init: RequestInit };

function harness(answer: (call: NetworkCall) => Response | Promise<Response>, timeoutMs = 1000) {
  const calls: NetworkCall[] = [];
  const saved: PairingPayload[] = [];
  const api = runInNewContext(
    transpile(`${gatewaySource}\n${transactionSource}
      const gatewayFetch = (input, init) => sendGatewayRequest(REQUEST_TIMEOUT_MS, input, init);
      ({requestPairing, claimPairing, beginPairingTransaction, claimPairingTransaction})`),
    {
      ...codec,
      URL,
      Date,
      REQUEST_TIMEOUT_MS: timeoutMs,
      CODE_PAIRING_CLAIM_AAD: codeAad,
      currentToken: oldToken,
      activeLocaleHeaders: () => ({ 'Accept-Language': 'en' }),
      shouldEncryptGatewayRequest: () => false,
      headerRecord,
      isStreamingRequest,
      startRequestBudget,
      withBodyDeadline,
      answerHasNoBody,
      validatePairingTransport,
      validateClaimedPairing,
      validateServerId,
      createRequestId: () => 'request-1',
      getInstallId: async () => 'install-1',
      codePairingMaterial: async () => key,
      saveGateway: async (
        claim: PairingPayload,
        displayName?: string,
        sshTunnel?: GatewaySshTunnel
      ): Promise<GatewayRecord> => {
        saved.push(claim);
        return {
          serverId: claim.server_id,
          label: displayName?.trim() || claim.label,
          url: claim.url,
          token: claim.token,
          deviceId: claim.device_id,
          transportKey: claim.transport_key,
          transport: claim.transport,
          ...(sshTunnel ? { sshTunnel } : {}),
          pairedAt: savedRecord.pairedAt,
        };
      },
      nitroFetch: async (input: RequestInfo | URL, init: RequestInit) => {
        const call = { url: String(input), init };
        calls.push(call);
        return answer(call);
      },
    }
  ) as Pick<typeof Gateway, 'requestPairing' | 'claimPairing'> &
    Pick<typeof Transaction, 'beginPairingTransaction' | 'claimPairingTransaction'>;
  return { ...api, calls, saved };
}

test('both pairing legs reject malformed URLs and QR keys before sending any request', async () => {
  const f = harness(() => Response.json(payload));
  for (const url of [
    'not a URL',
    'ftp://new-gateway.invalid',
    'http://user:password@100.64.0.1',
    'http://gateway.tailnet.ts.net?token=secret',
    'http://gateway.tailnet.ts.net/#fragment',
  ]) {
    await expect(f.requestPairing(url, 'request-1', 'Phone')).rejects.toThrow();
    await expect(f.claimPairing(url, 'request-1', 'ABCD-2345')).rejects.toThrow();
  }
  for (const url of ['http://new-gateway.invalid', 'https://new-gateway.invalid']) {
    await expect(
      f.requestPairing(url, 'request-1', 'Phone', undefined, 'invalid-key')
    ).rejects.toThrow('invalid encryption key');
    await expect(f.claimPairing(url, 'request-1', 'ABCD-2345', 'invalid-key')).rejects.toThrow(
      'invalid encryption key'
    );
  }
  expect(f.calls).toHaveLength(0);
});

test('manual HTTP(S) and encrypted QR destinations receive no existing credentials', async () => {
  for (const { url, transportKey } of [
    { url: 'http://new-gateway.invalid', transportKey: undefined },
    { url: 'https://new-gateway.invalid', transportKey: undefined },
    { url: 'http://new-gateway.invalid', transportKey: bootstrapKey },
  ]) {
    const qr = transportKey !== undefined;
    const f = harness(({ url: target, init }) => {
      const body = JSON.parse(String(init.body));
      const aad = `POST ${new URL(target).pathname}`;
      const plaintext = qr
        ? codec.decryptJson<Record<string, unknown>>(key, 'pairing-request', aad, body)
        : body;
      expect(plaintext.request_id).toBe('request-1');
      expect(JSON.stringify(init)).not.toContain(oldToken);
      expect(headerRecord(init.headers).Authorization).toBeUndefined();
      expect(headerRecord(init.headers).Cookie).toBeUndefined();
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      const result = target.endsWith('/claim') ? payload : requestResponse;
      return Response.json(
        qr ? codec.encryptJson(key, 'pairing-response', `${aad}\n${body.nonce}`, result) : result
      );
    });
    expect(await f.requestPairing(url, 'request-1', 'Phone', 'install-1', transportKey)).toEqual(
      requestResponse
    );
    expect(await f.claimPairing(url, 'request-1', 'ABCD-2345', transportKey)).toEqual(payload);
    expect(f.calls).toHaveLength(2);
    if (qr) expect(String(f.calls[1].init.body)).not.toContain('ABCD-2345');
  }
});

test('pairing redirects never resend a claim to a second destination', async () => {
  let initialRequests = 0;
  let redirectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/redirected') {
      redirectedRequests++;
      response.end(JSON.stringify(payload));
      return;
    }
    initialRequests++;
    response.writeHead(307, { Location: '/redirected' });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const f = harness(({ url: target, init }) => fetch(target, init));
    await expect(f.requestPairing(url, 'request-1', 'Phone')).rejects.toThrow();
    await expect(f.claimPairing(url, 'request-1', 'ABCD-2345')).rejects.toThrow();
    expect(initialRequests).toBe(2);
    expect(redirectedRequests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('pairing retains the response-body deadline', async () => {
  const f = harness(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        })
      ),
    10
  );
  await expect(
    f.requestPairing('https://new-gateway.invalid', 'request-1', 'Phone')
  ).rejects.toThrow('Timed out');
  expect(f.calls[0].init.signal?.aborted).toBe(true);
});

test('manual HTTP pairing requires sealed claims unless the Gateway reports disabled mode', async () => {
  const url = 'http://gateway.tailnet.ts.net:7347';
  for (const policy of [undefined, 'required', 'disabled'] as const) {
    const f = harness(({ url }) =>
      Response.json(
        url.endsWith('/request')
          ? { ...requestResponse, ...(policy ? { transport_encryption: policy } : {}) }
          : payload
      )
    );
    const pending = await f.beginPairingTransaction({ url }, 'Phone');
    expect(pending.offer.transportRequired).toBe(policy !== 'disabled');
    if (policy === 'disabled') {
      expect(await f.claimPairingTransaction(pending, 'ABCD-2345')).toEqual({
        ...savedRecord,
        url,
      });
      expect(f.saved).toEqual([{ ...payload, url }]);
    } else {
      await expect(f.claimPairingTransaction(pending, 'ABCD-2345')).rejects.toThrow(
        'encrypted pairing response'
      );
      expect(f.saved).toHaveLength(0);
    }
  }
});

test('manual HTTP, HTTPS and SSH pairing save code-sealed claims with the reached address', async () => {
  const encryptedPayload: PairingPayload = {
    ...payload,
    device_id: 'new-device',
    transport_key: bootstrapKey,
    transport: 'muqun-aes-256-gcm-v1',
  };
  for (const url of [
    'http://192.168.1.2:7347',
    'http://100.101.102.103:7347',
    'http://gateway.tailnet.ts.net:7347',
    'http://gateway:7347',
    'http://new-gateway.invalid:7347',
    'https://new-gateway.invalid',
    'http://127.0.0.1:51234',
  ]) {
    const ssh = url === 'http://127.0.0.1:51234';
    const f = harness(({ url: target, init }) => {
      const request = JSON.parse(String(init.body));
      expect(request.request_id).toBe('request-1');
      expect(JSON.stringify(init)).not.toContain(oldToken);
      expect(init.credentials).toBe('omit');
      if (target.endsWith('/request')) {
        expect(request.device_name).toBe('Phone');
        return Response.json({ ...requestResponse, transport_encryption: 'required' });
      }
      expect(request.code).toBe('ABCD-2345');
      return Response.json(codec.encryptJson(key, 'pairing-response', codeAad, encryptedPayload));
    });
    const pending = await f.beginPairingTransaction(
      {
        url,
        ...(ssh
          ? { sshTunnel: { hostId: 'ssh-host', remoteHost: '127.0.0.1', remotePort: 7347 } }
          : {}),
      },
      'Phone'
    );
    expect(await f.claimPairingTransaction(pending, 'ABCD-2345')).toEqual({
      ...savedRecord,
      url: ssh ? payload.url : url,
      deviceId: 'new-device',
      transportKey: bootstrapKey,
      transport: 'muqun-aes-256-gcm-v1',
      ...(ssh ? { sshTunnel: pending.offer.sshTunnel } : {}),
    });
    expect(f.saved).toEqual([{ ...encryptedPayload, url: ssh ? payload.url : url }]);
    expect(f.calls.map((call) => call.url)).toEqual([
      `${url}/api/pair/request`,
      `${url}/api/pair/claim`,
    ]);
  }
});
