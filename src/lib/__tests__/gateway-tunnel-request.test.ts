import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { directGatewayBaseUrl, GatewayTunnelUnavailableError } from '../ssh-tunnel';
import { dedupeKey, withRequestDedupe } from '../request-dedupe';
import { headerRecord } from '../request-budget';
import {
  bearerLeavesGateway,
  CLEARTEXT_TOKEN_REFUSAL,
  endpointCredentialRoute,
} from '../gateway-request-policy';
import { GATEWAY_TRANSPORT } from '../gateway-transport-id';
import type { GatewayRecord } from '../gateway-storage';

function fixture(tunnelled = true, sealed = true) {
  let open!: (value: { baseUrl: string; release: () => void }) => void;
  let refuse!: (error: Error) => void;
  const tunnel = new Promise<{ baseUrl: string; release: () => void }>((resolve, reject) => {
    open = resolve;
    refuse = reject;
  });
  let released = 0;
  let failure: Error | undefined;
  const calls: { endpoint?: GatewayRecord; url: string; init: RequestInit }[] = [];
  const record = {
    serverId: 'a',
    token: 'token-a',
    url: 'https://a.invalid',
    deviceId: 'device-a',
    transportKey: 'key-a',
    transport: sealed ? GATEWAY_TRANSPORT : undefined,
    ...(tunnelled ? { sshTunnel: { hostId: 'host-a' } } : {}),
  };
  const send = async (url: string, init: RequestInit, endpoint?: GatewayRecord) => {
    calls.push({ endpoint, url, init });
    if (failure) throw failure;
    return new Response('{}');
  };
  const scope = {
    URL,
    currentRecord: record as GatewayRecord | null,
    currentBaseUrl: tunnelled ? '' : record.url,
    currentToken: record.token,
    directGatewayBaseUrl,
    GatewayTunnelUnavailableError,
    CLEARTEXT_TOKEN_REFUSAL,
    bearerLeavesGateway,
    isGatewayEncryptionDisabled: () => false,
    inFlightGets: new Map(),
    dedupeKey,
    withRequestDedupe,
    activeLocaleHeaders: () => ({ 'Accept-Language': 'en' }),
    headerRecord,
    requestUrl: (input: string) => input,
    tunnelSessionOpener: () => tunnel,
    endpointCredentialRoute,
    encryptedGatewayFetch: (url: string, init: RequestInit, _: number, endpoint: GatewayRecord) =>
      send(url, init, endpoint),
    // A plain endpoint must not accidentally borrow the selected computer's key.
    shouldEncryptGatewayRequest: () => true,
    isStreamingRequest: () => false,
    fetchWithin: (_: number, __: string, url: string, init: RequestInit) => send(url, init),
    noteRefusedResponse: async () => {},
  };
  const request = runInNewContext(
    transpile(
      [
        'gatewayFetchWithin',
        'withRecordBaseUrl',
        'gatewayEndpointFetch',
        'sendGatewayRequest',
        'bearerOf',
      ]
        .map((name) => declaration('src/lib/gateway-client.ts', name))
        .join('\n') + '\n gatewayFetchWithin'
    ),
    scope
  ) as (timeout: number, path: string, init?: RequestInit) => Promise<Response>;
  return {
    request: (path: string, init?: RequestInit) => request(60_000, path, init),
    scope,
    calls,
    releaseCount: () => released,
    open: () => open({ baseUrl: 'http://127.0.0.1:40123', release: () => released++ }),
    refuse,
    fail: () => (failure = new Error('response lost')),
  };
}

test('cold Home reads and writes wait for SSH and retain their computer and credentials', async () => {
  for (const method of ['GET', 'POST']) {
    for (const sealed of [true, false]) {
      const f = fixture(true, sealed);
      const body =
        method === 'POST'
          ? JSON.stringify({ text: 'follow up', attachments: ['image.png'] })
          : undefined;
      const pending = f.request('/api/sessions/herdr/agent-sessions/a', { method, body });
      expect(f.calls).toHaveLength(0);
      f.scope.currentRecord = { ...f.scope.currentRecord!, serverId: 'b', token: 'token-b' };
      f.scope.currentToken = 'token-b';
      f.open();
      await pending;
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].url).toBe('http://127.0.0.1:40123/api/sessions/herdr/agent-sessions/a');
      if (sealed)
        expect(f.calls[0].endpoint).toMatchObject({
          serverId: 'a',
          token: 'token-a',
          deviceId: 'device-a',
          transportKey: 'key-a',
        });
      else expect(f.calls[0].endpoint).toBeUndefined();
      expect(f.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
      expect(f.calls[0].init.body).toBe(body);
      expect(f.releaseCount()).toBe(1);
    }
  }
});

test('failed tunnel sends nothing and ambiguous delivery is never retried', async () => {
  const refused = fixture();
  const pending = refused.request('/api/agent-sessions/a/prompt', { method: 'POST' });
  refused.refuse(new Error('SSH unavailable'));
  await expect(pending).rejects.toThrow('SSH unavailable');
  expect(refused.calls).toHaveLength(0);
  const uncertain = fixture();
  uncertain.fail();
  const send = uncertain.request('/api/agent-sessions/a/prompt', { method: 'POST' });
  uncertain.open();
  await expect(send).rejects.toThrow('response lost');
  expect(uncertain.calls).toHaveLength(1);
  expect(uncertain.releaseCount()).toBe(1);
});

test('live tunnel URLs resolve through the current lease and concurrent reads are deduplicated', async () => {
  const f = fixture();
  f.scope.currentBaseUrl = 'http://127.0.0.1:39999';
  const a = f.request('http://127.0.0.1:39999/api/history');
  const b = f.request('http://127.0.0.1:39999/api/history');
  f.open();
  const responses = await Promise.all([a, b]);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].url).toBe('http://127.0.0.1:40123/api/history');
  expect(await responses[0].text()).toBe('{}');
  expect(await responses[1].text()).toBe('{}');
  expect(f.releaseCount()).toBe(2);
});

test('direct reads remain direct; stale credentials and unconfigured paths cannot reach native fetch', async () => {
  const f = fixture(false);
  await f.request('https://a.invalid/api/history');
  expect(f.calls[0].url).toBe('https://a.invalid/api/history');
  expect(f.releaseCount()).toBe(0);
  await expect(
    f.request('/api/history', { headers: { Authorization: 'Bearer stale-token' } })
  ).rejects.toThrow('selected computer changed');
  f.scope.currentRecord = null;
  f.scope.currentBaseUrl = '';
  await expect(f.request('/api/history')).rejects.toThrow('connection is not ready');
  expect(f.calls).toHaveLength(1);
});

test('the existing development encryption override remains effective for selected requests', async () => {
  const f = fixture(false);
  f.scope.isGatewayEncryptionDisabled = () => true;
  await f.request('/api/history');
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].endpoint).toBeUndefined();
});
