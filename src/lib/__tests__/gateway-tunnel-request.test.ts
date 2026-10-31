import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { isTransientPreparationError } from '../agent-request-error';
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
import type { prepareAgentSessionAt, sessionPreparationSource } from '../agent-session-prepare';
import { SessionPreparationFlights } from '../foreground-session-activation';
import { assertDeliveryCurrent } from '../bound-delivery';

function fixture(tunnelled = true, sealed = true) {
  let open!: (value: { baseUrl: string; release: () => void }) => void;
  let refuse!: (error: Error) => void;
  const tunnel = new Promise<{ baseUrl: string; release: () => void }>((resolve, reject) => {
    open = resolve;
    refuse = reject;
  });
  let released = 0;
  let failure: Error | undefined;
  let responseBody = '{}';
  let responseJson: Promise<unknown> | undefined;
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
    const response = new Response(responseBody);
    if (responseJson) response.json = () => responseJson!;
    return response;
  };
  const scope = {
    URL,
    flights: new SessionPreparationFlights(),
    assertDeliveryCurrent,
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
    isTransientPreparationError,
    PREPARE_RETRY_DELAYS_MS: [0, 0],
  };
  const { request, prepare, source } = runInNewContext(
    transpile(
      [
        'gatewayFetchWithin',
        'withRecordBaseUrl',
        'gatewayEndpointFetch',
        'sendGatewayRequest',
        'bearerOf',
      ]
        .map((name) => declaration('src/lib/gateway-client.ts', name))
        .join('\n') +
        '\n' +
        ['sessionPreparationSource', 'prepareAgentSessionAt']
          .map((name) => declaration('src/lib/agent-session-prepare.ts', name))
          .join('\n') +
        '\n ({ request: gatewayFetchWithin, prepare: prepareAgentSessionAt, source: sessionPreparationSource })'
    ),
    scope
  ) as {
    request: (timeout: number, path: string, init?: RequestInit) => Promise<Response>;
    prepare: typeof prepareAgentSessionAt;
    source: typeof sessionPreparationSource;
  };
  return {
    request: (path: string, init?: RequestInit) => request(60_000, path, init),
    record,
    source: () => source('a', record as GatewayRecord),
    prepare: (current: () => boolean = () => true) => {
      responseBody = '{"data":{"prepared":true}}';
      return prepare({
        serverId: 'a',
        record: record as GatewayRecord,
        current,
        agentId: 'opaque/agent',
        asid: 'opaque/session',
        capabilities: ['agent_session_resume_v1'],
      });
    },
    scope,
    calls,
    releaseCount: () => released,
    open: () => open({ baseUrl: 'http://127.0.0.1:40123', release: () => released++ }),
    refuse,
    fail: () => (failure = new Error('response lost')),
    holdJson: (reply: Promise<unknown>) => {
      responseJson = reply;
    },
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

test('session preparation holds the captured SSH lease and never uses the stored phone loopback', async () => {
  for (const sealed of [true, false]) {
    const f = fixture(true, sealed);
    f.record.url = 'http://127.0.0.1:23847';
    const pending = f.prepare();
    expect(f.calls).toHaveLength(0);
    f.scope.currentRecord = { ...f.scope.currentRecord!, serverId: 'b', token: 'foreign-token' };
    f.scope.currentToken = 'foreign-token';
    f.open();
    await pending;
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(
      'http://127.0.0.1:40123/api/agents/opaque%2Fagent/sessions/opaque%2Fsession/prepare'
    );
    expect(f.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
    expect(f.calls[0].init.body).toBeUndefined();
    if (sealed) expect(f.calls[0].endpoint?.transportKey).toBe('key-a');
    else expect(f.calls[0].endpoint).toBeUndefined();
    expect(f.releaseCount()).toBe(1);
  }
});

test('prepare never falls back on tunnel refusal and canceled opening sends nothing', async () => {
  const refused = fixture();
  const first = refused.prepare();
  refused.refuse(new Error('SSH unavailable'));
  await expect(first).rejects.toThrow('SSH unavailable');
  expect(refused.calls).toHaveLength(0);
  let current = true;
  const stale = fixture();
  const pending = stale.prepare(() => current);
  current = false;
  stale.open();
  await expect(pending).rejects.toThrow('no longer active');
  expect(stale.calls).toHaveLength(0);
  expect(stale.releaseCount()).toBe(1);
});

test('a newer foreground owner joins a pending prepare after the old open is canceled', async () => {
  const f = fixture();
  let old = true;
  const first = f.prepare(() => old);
  old = false;
  const second = f.prepare(() => true);
  expect(first).toBe(second);
  f.open();
  await Promise.all([first, second]);
  expect(f.calls).toHaveLength(1);
  expect(f.releaseCount()).toBe(1);
});

test('SSH configuration changes alter prepare scope and do not mutate the captured tunnel target', async () => {
  const f = fixture();
  const source = f.source();
  const pending = f.prepare();
  f.record.sshTunnel!.hostId = 'new-host';
  expect(f.source()).not.toBe(source);
  f.open();
  await pending;
  expect(f.calls[0].endpoint?.sshTunnel?.hostId).toBe('host-a');
});

test('ambiguous prepare delivery releases its SSH lease without retrying', async () => {
  const f = fixture();
  f.fail();
  const pending = f.prepare();
  f.open();
  await expect(pending).rejects.toThrow('response lost');
  expect(f.calls).toHaveLength(1);
  expect(f.releaseCount()).toBe(1);
});

test('prepare retains its tunnel through response decoding and releases on a malformed acknowledgment', async () => {
  const f = fixture();
  const body = Promise.withResolvers<unknown>();
  f.holdJson(body.promise);
  const pending = f.prepare();
  f.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.calls).toHaveLength(1);
  expect(f.releaseCount()).toBe(0);
  body.resolve({ data: { prepared: false } });
  await expect(pending).rejects.toThrow('unreadable response');
  expect(f.releaseCount()).toBe(1);
  expect(f.calls).toHaveLength(1);
});
