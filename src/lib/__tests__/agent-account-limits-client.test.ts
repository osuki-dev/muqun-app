import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as protocol from '../agent-account-limits';
import type { GatewayEndpoint } from '../gateway-client';

const require = createRequire(import.meta.url);
const code = require('@babel/core').transformSync(
  readFileSync(new URL('../agent-account-limits-client.ts', import.meta.url), 'utf8'),
  {
    filename: 'agent-account-limits-client.ts',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

function fixture(tunnel = false) {
  const records = [
    {
      serverId: 'a',
      url: 'https://a.example',
      token: 'fixture-a',
      transportKey: 'fixture-key-a',
      sshTunnel: tunnel,
    },
    { serverId: 'b', url: 'https://b.example', token: 'fixture-b', transportKey: 'fixture-key-b' },
  ];
  let selected = records[1]!;
  let tunnelUrl: string | null = null;
  let status = 200;
  const requests: { endpoint: GatewayEndpoint; url: string; init: RequestInit }[] = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name.startsWith('@babel/runtime/')) return require(name);
      if (name === './agent-account-limits') return protocol;
      if (name === '@/stores/gateway-connection')
        return { useGatewayConnectionStore: { getState: () => ({ record: selected, records }) } };
      if (name === './gateway-client')
        return {
          configuredGatewayServerId: () => selected.serverId,
          effectiveGatewayBaseUrl: (record: typeof selected | null) =>
            record?.sshTunnel ? (tunnelUrl ?? record.url) : (record?.url ?? ''),
          gatewayEndpointFetch: async (
            endpoint: GatewayEndpoint,
            url: string,
            init: RequestInit
          ) => {
            requests.push({ endpoint, url, init });
            selected = records[1]!;
            return Response.json(
              {
                data: {
                  status: 'available',
                  reason: null,
                  observed_at_ms: 1,
                  ordinary_usage_allowed: null,
                  limits: [],
                },
              },
              { status }
            );
          },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    read: exports.readAgentAccountLimits as typeof import('../agent-account-limits-client').readAgentAccountLimits,
    requests,
    connectTunnel: () => {
      selected = records[0]!;
      tunnelUrl = 'http://127.0.0.1:45678';
    },
    fail: () => {
      status = 503;
    },
  };
}

test('account read captures the exact server endpoint and opaque agent, independent of selected server', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const result = await f.read('a', 'agent/opaque ?+', signal);
  expect(result.status).toBe('available');
  expect(f.requests[0]!.endpoint.token).toBe('fixture-a');
  expect(f.requests[0]!.endpoint.transportKey).toBe('fixture-key-a');
  expect(f.requests[0]!.url).toBe(
    'https://a.example/api/agents/agent%2Fopaque%20%3F%2B/account-limits'
  );
  expect(f.requests[0]!.init.signal).toBe(signal);
  await expect(f.read('missing', 'agent', signal)).rejects.toThrow();
  for (const agentId of ['', '.', '..']) {
    await expect(f.read('a', agentId, new AbortController().signal)).rejects.toThrow();
  }
  expect(f.requests).toHaveLength(1);
});

test('tunnel records never fall back to their stored address and use only an active tunnel', async () => {
  const f = fixture(true);
  await expect(f.read('a', 'agent', new AbortController().signal)).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
  f.connectTunnel();
  await f.read('a', 'agent', new AbortController().signal);
  expect(f.requests[0]!.url).toBe('http://127.0.0.1:45678/api/agents/agent/account-limits');
  expect(f.requests[0]!.endpoint.token).toBe('fixture-a');
});

test('failed reads reject without retry or fabricated available values', async () => {
  const f = fixture();
  f.fail();
  await expect(f.read('a', 'agent', new AbortController().signal)).rejects.toThrow();
  expect(f.requests).toHaveLength(1);
});
