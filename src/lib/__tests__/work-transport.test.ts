import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDeliveryCurrent } from '../bound-delivery';
import type { WorkTransport } from '../work-api';
import type { GatewayRecord } from '../gateway-storage';
import { GatewayTransportRefusalError } from '../gateway-refusal';

test('collaboration delivery captures its server and encodes the native target without global selection', async () => {
  const source = ts.createSourceFile(
    'gateway-client.ts',
    readFileSync('src/lib/gateway-client.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const statement = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'sendBoundAgentText'
  );
  if (!statement) throw new Error('Missing production bound agent sender');
  const calls: unknown[][] = [];
  const compiled = ts.transpileModule(
    statement.getText(source).replace(/^export /, '') + '\nglobalThis.send=sendBoundAgentText;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const sandbox = {
    assertDeliveryCurrent,
    GatewayTransportRefusalError,
    isDemoRecord: () => false,
    sendBoundWorkRequest: async (...args: unknown[]) => {
      calls.push(args);
      return { status: 200, body: { result: { ok: true } } };
    },
    send: undefined as
      | ((
          record: GatewayRecord,
          session: string,
          target: string,
          text: string,
          current: () => boolean
        ) => Promise<void>)
      | undefined,
  };
  runInNewContext(compiled, sandbox);
  if (!sandbox.send) throw new Error('Sender did not initialize');
  const record = {
    serverId: 'captured',
    label: 'Captured',
    url: 'https://captured.invalid',
    token: 'captured-token',
    pairedAt: 1,
  };
  await sandbox.send(record, 'session/a', 'target?#', 'Follow up', () => true);
  expect(calls[0]?.[0]).toBe(record);
  expect(calls[0]?.[1]).toBe('/api/sessions/session%2Fa/agents/target%3F%23/send');
  expect(calls[0]?.[2]).toMatchObject({ method: 'POST', body: '{"text":"Follow up"}' });
  await expect(
    sandbox.send(record, 'session/a', 'target', 'Not sent', () => false)
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});

/** Run the production adapter with native transport seams replaced, not a copied adapter. */
function adapter(
  options: { encrypted?: boolean; loseOwnership?: boolean; cleanupFails?: boolean } = {}
) {
  const source = ts.createSourceFile(
    'gateway-client.ts',
    readFileSync('src/lib/gateway-client.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const statement = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(source) === 'sendBoundWorkRequest'
      )
  );
  if (!statement) throw new Error('Missing production transport adapter');
  const calls: { url: string; endpoint?: GatewayRecord; init: RequestInit }[] = [];
  let current = true;
  let released = 0;
  const request = async (
    url: string,
    init: RequestInit,
    _timeout?: number,
    endpoint?: GatewayRecord
  ) => {
    calls.push({ url, init, endpoint });
    return { ok: true, status: 200, text: async () => '{"receipt":"ok"}' };
  };
  const compiled = ts.transpileModule(
    statement.getText(source).replace(/^export /, '') +
      '\nglobalThis.adapter=sendBoundWorkRequest;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const release = () => {
    released++;
    if (options.cleanupFails) throw new Error('lease release failed');
  };
  const sandbox = {
    isDemoRecord: () => false,
    assertDeliveryCurrent,
    GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
    activeLocaleHeaders: () => ({ 'Accept-Language': 'en' }),
    withRecordBaseUrl: async (_record: GatewayRecord, body: (url: string) => Promise<unknown>) => {
      if (options.loseOwnership) current = false;
      try {
        return await body('http://127.0.0.1:45678');
      } finally {
        release();
      }
    },
    encryptedGatewayFetch: request,
    fetchWithin: (_timeout: number, _message: string, url: string, init: RequestInit) =>
      request(url, init),
    adapter: undefined as WorkTransport | undefined,
  };
  runInNewContext(compiled, sandbox);
  if (!sandbox.adapter) throw new Error('Adapter did not initialize');
  const record: GatewayRecord = {
    serverId: 'a',
    label: 'A',
    url: 'https://a.invalid',
    token: 'token-a',
    pairedAt: 1,
    ...(options.encrypted
      ? { transport: 'muqun-aes-256-gcm-v1' as const, deviceId: 'device-a', transportKey: 'key-a' }
      : {}),
  };
  return {
    send: sandbox.adapter,
    record,
    calls,
    isCurrent: () => current,
    released: () => released,
  };
}

for (const encrypted of [false, true])
  test(`work transport keeps captured ${encrypted ? 'encrypted' : 'direct'} credentials through tunnel resolution`, async () => {
    const client = adapter({ encrypted });
    const response = await client.send(client.record, '/api/sessions/a/work/tasks', {
      method: 'POST',
      body: '{"request_key":"key"}',
      isCurrent: client.isCurrent,
    });
    expect(response).toEqual({ status: 200, body: { receipt: 'ok' } });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].url).toBe('http://127.0.0.1:45678/api/sessions/a/work/tasks');
    expect(client.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer token-a' });
    if (encrypted)
      expect(client.calls[0].endpoint).toMatchObject({
        token: 'token-a',
        deviceId: 'device-a',
        transportKey: 'key-a',
      });
    expect(client.released()).toBe(1);
  });
test('work transport refuses after ownership loss while the tunnel opens', async () => {
  const client = adapter({ loseOwnership: true });
  await expect(
    client.send(client.record, '/api/sessions/a/work/tasks', {
      method: 'POST',
      body: '{}',
      isCurrent: client.isCurrent,
    })
  ).rejects.toThrow();
  expect(client.calls).toHaveLength(0);
  expect(client.released()).toBe(1);
});
test('lease cleanup failure never erases acknowledged work or retries a mutation', async () => {
  const client = adapter({ cleanupFails: true });
  expect(
    await client.send(client.record, '/api/sessions/a/work/tasks', {
      method: 'POST',
      body: '{}',
      isCurrent: client.isCurrent,
    })
  ).toEqual({ status: 200, body: { receipt: 'ok' } });
  expect(client.calls).toHaveLength(1);
});
