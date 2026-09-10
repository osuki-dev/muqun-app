import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDeliveryCurrent, DeliveryOwnership } from '../bound-delivery';
import {
  spawnedAgentFromResponse,
  type AgentSpawnRequest,
  type SpawnedAgent,
} from '../agent-spawn';
import type { GatewayRecord } from '../gateway-storage';

const a: GatewayRecord = {
  serverId: 'a',
  url: 'https://a.invalid',
  label: 'A',
  token: 'a-token',
  pairedAt: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const source = ts.createSourceFile(
    'client.ts',
    readFileSync('src/lib/gateway-client.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const declarations = ['spawnBoundAgent', 'withRecordBaseUrl']
    .map((name) => {
      const node = source.statements.find(
        (item) => ts.isFunctionDeclaration(item) && item.name?.text === name
      );
      if (!node) throw new Error(`Missing production ${name}`);
      return node.getText(source).replace(/^export /, '');
    })
    .join('\n');
  const tunnel = deferred<void>();
  const reply = deferred<unknown>();
  let delayTunnel = false;
  let releases = 0;
  let failCleanup = false;
  let demoCalls = 0;
  const calls: {
    url: string;
    token: string;
    timeout: number;
    body: string;
    endpoint?: GatewayRecord;
  }[] = [];
  const response = { ok: true, status: 207, text: async () => '', json: () => reply.promise };
  const globals = {
    assertDeliveryCurrent,
    spawnedAgentFromResponse,
    // Hostile current selection: any accidental global fallback is visible.
    currentBaseUrl: 'https://b.invalid',
    currentToken: 'b-token',
    currentDeviceId: 'b-device',
    currentTransportKey: 'b-key',
    GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
    activeLocaleHeaders: () => ({}),
    isDemoRecord: (record: GatewayRecord) => record.serverId === 'demo',
    demoSpawnedAgent: () => {
      demoCalls++;
      return { pane_id: 'demo-pane' };
    },
    directGatewayBaseUrl: (record: GatewayRecord) => (record.sshTunnel ? null : record.url),
    tunnelSessionOpener: async () => {
      if (delayTunnel) await tunnel.promise;
      return {
        baseUrl: 'http://fixture-tunnel.invalid',
        release: () => {
          releases++;
          if (failCleanup) throw new Error('cleanup failure');
        },
      };
    },
    fetchWithin: async (
      timeout: number,
      _message: string,
      url: string,
      init: { headers: { Authorization: string }; body: string }
    ) => {
      calls.push({ timeout, url, token: init.headers.Authorization, body: init.body });
      return response;
    },
    encryptedGatewayFetch: async (
      url: string,
      init: { body: string },
      timeout: number,
      endpoint: GatewayRecord,
      valid: () => boolean
    ) => {
      assertDeliveryCurrent(valid);
      calls.push({ timeout, url, token: endpoint.token, body: init.body, endpoint });
      return response;
    },
  };
  const spawn = runInNewContext(
    ts.transpileModule(`${declarations}\nspawnBoundAgent`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    globals
  ) as (
    record: GatewayRecord,
    session: string,
    request: AgentSpawnRequest,
    valid: () => boolean
  ) => Promise<SpawnedAgent>;
  return {
    spawn,
    calls,
    reply,
    tunnel,
    releases: () => releases,
    demoCalls: () => demoCalls,
    waitTunnel: () => {
      delayTunnel = true;
    },
    failCleanup: () => {
      failCleanup = true;
    },
  };
}

test('direct and encrypted spawn use captured A credentials and preserve late acknowledged outcomes', async () => {
  for (const encrypted of [false, true]) {
    const f = fixture();
    const owner = new DeliveryOwnership();
    const record = encrypted
      ? {
          ...a,
          transport: 'muqun-aes-256-gcm-v1' as const,
          deviceId: 'a-device',
          transportKey: 'a-key',
        }
      : a;
    const pending = f.spawn(
      record,
      'same/session',
      { agent: 'claude', prompt: 'fixture' },
      owner.capture()
    );
    await turn();
    owner.invalidate(); // A→B→A must not throw away already-created pane history.
    f.reply.resolve({ pane_id: 'created-pane', agent_started: true, prompt_submitted: false });
    expect((await pending).paneId).toBe('created-pane');
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].timeout).toBe(60_000);
    expect(f.calls[0].url).toBe('https://a.invalid/api/sessions/same%2Fsession/agents/spawn');
    expect(f.calls[0].token).toBe(encrypted ? 'a-token' : 'Bearer a-token');
    if (encrypted) {
      expect(f.calls[0].endpoint?.deviceId).toBe('a-device');
      expect(f.calls[0].endpoint?.transportKey).toBe('a-key');
    }
  }
});

test('context loss during tunnel setup prevents transmission and releases the lease', async () => {
  const f = fixture();
  f.waitTunnel();
  const owner = new DeliveryOwnership();
  const pending = f.spawn(
    { ...a, sshTunnel: { hostId: 'qa', remoteHost: 'localhost', remotePort: 1 } },
    's',
    { agent: 'claude' },
    owner.capture()
  );
  owner.invalidate();
  f.tunnel.resolve();
  await expect(pending).rejects.toThrow('no longer active');
  expect(f.calls).toEqual([]);
  expect(f.releases()).toBe(1);
});

test('request is snapshotted before tunnel setup and lease lasts until body parsing', async () => {
  const f = fixture();
  f.waitTunnel();
  const request = { agent: 'claude', prompt: 'reviewed' };
  const pending = f.spawn(
    { ...a, sshTunnel: { hostId: 'qa', remoteHost: 'localhost', remotePort: 1 } },
    's',
    request,
    () => true
  );
  request.prompt = 'unreviewed';
  f.tunnel.resolve();
  await turn();
  expect(JSON.parse(f.calls[0].body).prompt).toBe('reviewed');
  expect(f.releases()).toBe(0);
  f.reply.resolve({ pane_id: 'p' });
  await pending;
  expect(f.releases()).toBe(1);
});

test('ambiguous response fails once without retry and releases tunnel', async () => {
  const f = fixture();
  const pending = f.spawn(
    { ...a, sshTunnel: { hostId: 'qa', remoteHost: 'localhost', remotePort: 1 } },
    's',
    { agent: 'claude' },
    () => true
  );
  await turn();
  f.reply.reject(new Error('connection lost after send'));
  await expect(pending).rejects.toThrow('connection lost after send');
  expect(f.calls.length).toBe(1);
  expect(f.releases()).toBe(1);
});

test('cleanup failure cannot discard a known created pane or cause a retry', async () => {
  const f = fixture();
  f.failCleanup();
  f.reply.resolve({ pane_id: 'created' });
  const result = await f.spawn(
    { ...a, sshTunnel: { hostId: 'qa', remoteHost: 'localhost', remotePort: 1 } },
    's',
    { agent: 'claude' },
    () => true
  );
  expect(result.paneId).toBe('created');
  expect(f.calls.length).toBe(1);
  expect(f.releases()).toBe(1);
});

test('only a captured Demo record uses offline spawn and invalid context cannot start it', async () => {
  const f = fixture();
  const demo = { ...a, serverId: 'demo' };
  expect((await f.spawn(demo, 's', { agent: 'claude' }, () => true)).paneId).toBe('demo-pane');
  await expect(f.spawn(demo, 's', { agent: 'claude' }, () => false)).rejects.toThrow(
    'no longer active'
  );
  expect(f.demoCalls()).toBe(1);
  expect(f.calls).toEqual([]);
});
