import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import type { GatewayRecord } from '../gateway-storage';
import { declaration, transpile } from '../../test-support/production-source';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
// The real constant, not a copy: the rule is executed in the sandbox below and
// closes over this. Leaving it out made every reference throw a ReferenceError
// that `register`'s own catch swallowed, so the effect looked silent for the
// wrong reason -- indistinguishable, from the outside, from "nothing was due".
import {
  PUSH_TOKEN_MAX_AGE_MS,
  PUSH_TOKEN_OWNER_BINDING_CAPABILITY,
  type RegisteredPushToken,
} from '../push-token-rule';

/** Execute the actual production effect with inert native/network ports. No
 * React Native imports, global module mocks, devices or push credentials. */

/**
 * The persisted "what this device already told this server" store, faked as a
 * map so a test can hand the same one to two runs of the effect and watch the
 * second stay silent -- which is the whole point of the rule.
 */
type TokenStore = Map<string, RegisteredPushToken>;

function harness(
  store: TokenStore = new Map(),
  options: {
    refuse?: boolean;
    token?: () => Promise<string>;
    register?: () => Promise<void>;
    unregister?: () => Promise<void>;
  } = {}
) {
  const calls: string[] = [];
  const posts: GatewayRecord[] = [];
  let cleanup: (() => void) | undefined;
  let foreground: ((state: string) => void) | undefined;
  let current: GatewayRecord | null = null;
  let enabled = true;
  let bindsOwner = false;
  let faulted = false;
  const settings = Object.assign(
    (selector: (state: { notificationsEnabled: boolean; language: string }) => unknown) =>
      selector(settings.getState()),
    { getState: () => ({ notificationsEnabled: enabled, language: 'en' }) }
  );
  const source = [
    'let pushOperation = Promise.resolve();',
    declaration('src/lib/demo-gateway.ts', 'isDemoRecord'),
    declaration('src/lib/push-token-rule.ts', 'pushTokenNeedsSending'),
    declaration('src/lib/push-token-registry.ts', 'pushPairingIdentity'),
    declaration('src/lib/notifications.ts', 'appBuildIdentity'),
    declaration('src/lib/notifications.ts', 'serializePushOperation'),
    declaration('src/lib/compiler-safe-control-flow.ts', 'recoverWith'),
    declaration('src/lib/notifications.ts', 'useGatewayPushRegistration'),
    'useGatewayPushRegistration',
  ].join('\n');
  const start = runInNewContext(transpile(source), {
    DEMO_SERVER_ID: DEMO_PAIRING_SERVER_ID,
    QuickCrypto: crypto,
    useAppSettings: settings,
    useServerCapabilities: (selector: (state: { byServer: Record<string, string[]> }) => unknown) =>
      selector({
        byServer:
          current && bindsOwner
            ? { [current.serverId]: [PUSH_TOKEN_OWNER_BINDING_CAPABILITY] }
            : {},
      }),
    useGatewayConnectionStore: { getState: () => ({ record: current }) },
    usePairingFaults: (selector: (state: { byServer: Record<string, unknown> }) => unknown) =>
      selector({ byServer: current && faulted ? { [current.serverId]: { fault: 'repair' } } : {} }),
    pairingFaultOf: (state: { byServer: Record<string, { fault?: string }> }, serverId: string) =>
      state.byServer[serverId]?.fault,
    useEffect: (body: () => (() => void) | undefined) => {
      cleanup = body();
    },
    registerForPushNotificationsAsync: async () => {
      calls.push('token lookup');
      return options.token ? options.token() : 'fixture-token';
    },
    registerDevicePushToken: async (record: GatewayRecord) => {
      calls.push('gateway register');
      posts.push(record);
      await options.register?.();
      if (options.refuse) throw new Error('HTTP 409: push_token_owned');
    },
    Application: { nativeApplicationVersion: '3.0.0', nativeBuildVersion: '41' },
    getActiveLocale: () => 'en',
    PUSH_TOKEN_MAX_AGE_MS,
    PUSH_TOKEN_OWNER_BINDING_CAPABILITY,
    registeredPushToken: (id: string) => store.get(id) ?? null,
    rememberRegisteredPushToken: (id: string, entry: Omit<RegisteredPushToken, 'atMs'>) => {
      calls.push('remember');
      store.set(id, { ...entry, atMs: Date.now() });
    },
    unregisterPushNotificationsAsync: async (record: GatewayRecord | null) => {
      calls.push(`unregister:${Boolean(record)}`);
      await options.unregister?.();
      store.clear();
      calls.push('unregistered');
    },
    AppState: {
      addEventListener: (_: string, listener: (state: string) => void) => {
        calls.push('listen');
        foreground = listener;
        return { remove: () => calls.push('unlisten') };
      },
    },
    Platform: { OS: 'ios' },
    Device: {},
    __DEV__: false,
  }) as (record: GatewayRecord | null) => void;
  return {
    calls,
    posts,
    store,
    mount(
      serverId: string | null,
      on: boolean,
      capability = false,
      deviceId = 'fixture-device',
      fault = false
    ) {
      cleanup?.();
      enabled = on;
      bindsOwner = capability;
      faulted = fault;
      current =
        serverId === null
          ? null
          : {
              serverId,
              deviceId,
              url: `http://${serverId}.invalid`,
              token: `fixture-${deviceId}`,
              label: 'Fixture',
              pairedAt: 1,
            };
      start(current);
    },
    replace(record: GatewayRecord | null) {
      current = record;
    },
    foreground: () => foreground?.('active'),
    cleanup: () => cleanup?.(),
  };
}

function effect(
  serverId: string | null,
  enabled: boolean,
  store: TokenStore = new Map(),
  options: { refuse?: boolean } = {}
) {
  const run = harness(store, options);
  run.mount(serverId, enabled);
  return run;
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('demo skips both push registration and disabled-notification token removal', async () => {
  for (const enabled of [true, false]) {
    const run = effect(DEMO_PAIRING_SERVER_ID, enabled);
    await new Promise<void>((resolve) => setImmediate(resolve));
    run.foreground();
    await new Promise<void>((resolve) => setImmediate(resolve));
    run.cleanup();
    expect(run.calls).toEqual([]);
  }
});

test('real record still registers and detaches its foreground observer', async () => {
  const run = effect('paired-fixture', true);
  await settle();
  expect(run.calls).toEqual(['listen', 'token lookup', 'gateway register', 'remember']);
  run.cleanup();
  expect(run.calls.at(-1)).toBe('unlisten');
});

test('a computer that refused this pairing is not told the token until paired again', async () => {
  // Every foreground would otherwise post to a gateway that answers 426 or
  // `invalid_token` to it; the fault clears when the record is paired again,
  // which re-runs the effect with a new record.
  const run = harness(new Map(), {});
  run.mount('paired-fixture', true, false, 'fixture-device', true);
  await settle();
  run.foreground();
  await settle();
  expect(run.calls).toEqual([]);
  run.mount('paired-fixture', true);
  await settle();
  expect(run.calls).toEqual(['listen', 'token lookup', 'gateway register', 'remember']);
});

test('a renamed or reselected server does not re-post an unchanged token', async () => {
  // A new `record` object for the same machine is what the connection store
  // hands back on select, rename and edit, and it tears this effect down and
  // builds it again. The old closure local was lost with it, so the token went
  // back on the wire; the persisted record is what stops that now.
  const store: TokenStore = new Map();
  const first = effect('paired-fixture', true, store);
  await settle();
  expect(first.calls).toContain('gateway register');
  first.cleanup();

  const second = effect('paired-fixture', true, store);
  await settle();
  expect(second.calls).toEqual(['listen', 'token lookup']);
});

test('returning to the foreground does not re-post either', async () => {
  const run = effect('paired-fixture', true);
  await settle();
  const after = run.calls.length;
  run.foreground();
  await settle();
  expect(run.calls.slice(after)).toEqual(['token lookup']);
});

test('a server this device has not told yet is told, even when another was', async () => {
  const store: TokenStore = new Map();
  const first = effect('paired-fixture', true, store);
  await settle();
  first.cleanup();

  const other = effect('second-machine', true, store);
  await settle();
  expect(other.calls).toContain('gateway register');
});

test('a registration older than a week is asserted again', async () => {
  // The gateway can lose its device row without anything on this device
  // changing -- a reinstall, a restore from an older backup -- and from here
  // that is invisible: the token still looks registered and pushes just stop.
  // The age rule is the bound on how long that can last, and this is the wiring
  // that carries the stored record to it.
  const store: TokenStore = new Map();
  store.set('paired-fixture', {
    token: 'fixture-token',
    build: '3.0.0+41',
    atMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
  });
  const run = effect('paired-fixture', true, store);
  await settle();
  expect(run.calls).toContain('gateway register');
  // And the fresh stamp means the next launch is silent again.
  expect(Date.now() - (store.get('paired-fixture')?.atMs ?? 0)).toBeLessThan(60_000);
});

test('a post the gateway refused is not remembered, so the next try sends it', async () => {
  // Remembering a token the gateway never accepted is the one failure worth
  // more than a wasted request: notifications would stop arriving, and nothing
  // would ever try again.
  const store: TokenStore = new Map();
  const refused = effect('paired-fixture', true, store, { refuse: true });
  await settle();
  expect(refused.calls).toContain('gateway register');
  expect(refused.calls).not.toContain('remember');
  expect(store.size).toBe(0);
  refused.cleanup();

  const again = effect('paired-fixture', true, store);
  await settle();
  expect(again.calls).toContain('gateway register');
  expect(again.calls).toContain('remember');
});

test('real disabled notifications still unregister the captured record or just the device', async () => {
  const paired = effect('paired-fixture', false);
  const unpaired = effect(null, false);
  await settle();
  expect(paired.calls).toEqual(['unregister:true', 'unregistered']);
  expect(unpaired.calls).toEqual(['unregister:false', 'unregistered']);
  expect(effect(null, true).calls).toEqual([]);
});

test('capability arrival migrates a recent receipt once, and a new device owes its own acknowledgement', async () => {
  const store: TokenStore = new Map([
    ['paired', { token: 'fixture-token', build: '3.0.0+41', locale: 'en', atMs: Date.now() }],
  ]);
  const run = harness(store);
  run.mount('paired', true);
  await settle();
  expect(run.posts).toHaveLength(0);
  run.mount('paired', true, true);
  await settle();
  expect(run.posts).toHaveLength(1);
  expect(store.get('paired')?.ownerBinding).toMatchObject({
    revision: 1,
    deviceId: 'fixture-device',
  });
  run.foreground();
  run.mount('paired', true, true);
  await settle();
  expect(run.posts).toHaveLength(1);
  run.mount('paired', true, true, 'replacement-device');
  await settle();
  expect(run.posts).toHaveLength(2);
  expect(store.get('paired')?.ownerBinding?.deviceId).toBe('replacement-device');
});

test('a refused ownership migration remains due without delete, reassignment, or an immediate retry', async () => {
  const options = { refuse: true };
  const run = harness(new Map(), options);
  run.mount('paired', true, true);
  await settle();
  expect(run.posts).toHaveLength(1);
  expect(run.store.size).toBe(0);
  expect(run.calls.some((call) => call.startsWith('unregister'))).toBe(false);
  options.refuse = false;
  run.foreground();
  await settle();
  expect(run.posts).toHaveLength(2);
  expect(run.store.get('paired')?.ownerBinding?.revision).toBe(1);
});

test('changing computers during token acquisition never posts to the replacement shared client', async () => {
  let release!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    release = resolve;
  });
  const run = harness(new Map(), { token: () => token });
  run.mount('old-computer', true, true);
  await settle();
  run.replace({
    serverId: 'replacement',
    label: 'Fixture',
    url: 'http://replacement.invalid',
    token: 'fixture-other',
    pairedAt: 1,
  });
  release('fixture-token');
  await settle();
  expect(run.posts).toHaveLength(0);
  expect(run.store.size).toBe(0);
});

test('a late success for an old pairing does not save an ownership receipt', async () => {
  let release!: () => void;
  const ack = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = harness(new Map(), { register: () => ack });
  run.mount('paired', true, true);
  await settle();
  expect(run.posts).toHaveLength(1);
  run.replace({ ...run.posts[0]!, deviceId: 'new-device', token: 'new-credential' });
  release();
  await settle();
  expect(run.store.size).toBe(0);
});

test('an in-flight Off finishes before On registers, so it cannot erase the new receipt', async () => {
  let release!: () => void;
  const removed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = harness(new Map(), { unregister: () => removed });
  run.mount('paired', true, true);
  await settle();
  run.mount('paired', false, true);
  await settle();
  run.mount('paired', true, true);
  await settle();
  expect(run.posts).toHaveLength(1);
  release();
  await settle();
  expect(run.posts).toHaveLength(2);
  expect(run.calls.indexOf('unregistered')).toBeLessThan(run.calls.lastIndexOf('gateway register'));
  expect(run.store.get('paired')?.ownerBinding?.revision).toBe(1);
});

test('legacy unowned DELETE 409 still completes local Off using the original record', async () => {
  const record = { serverId: 'old' };
  const calls: unknown[] = [];
  const off = runInNewContext(
    transpile(
      `${declaration('src/lib/notifications.ts', 'unregisterPushNotificationsAsync')}\nunregisterPushNotificationsAsync`
    ),
    {
      process: { env: { EXPO_OS: 'ios' } },
      currentExpoPushTokenAsync: async () => 'fixture-token',
      unregisterDevicePushToken: async (target: unknown, token: string) => {
        calls.push([target, token]);
        throw new Error('HTTP 409: push_token_owned');
      },
      Notifications: {
        unregisterForNotificationsAsync: async () => {
          calls.push('OS unregister');
        },
      },
      forgetRegisteredPushToken: () => calls.push('forget'),
    }
  ) as (record: unknown) => Promise<void>;
  await off(record);
  expect(calls).toEqual([[record, 'fixture-token'], 'OS unregister', 'forget']);
});

test('the production token writer preserves explicit HTTP and encrypted record ownership and requires a success receipt', async () => {
  const calls: { transport: string; url: string; init: RequestInit; endpoint?: unknown }[] = [];
  let response = {
    ok: true,
    status: 200,
    text: async () => '',
    json: async (): Promise<unknown> => ({ ok: true }),
  };
  const write = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'writeDevicePushToken')}\nwriteDevicePushToken`
    ),
    {
      isDemoRecord: () => false,
      activeLocaleHeaders: () => ({}),
      GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
      REQUEST_TIMEOUT_MS: 1000,
      withRecordBaseUrl: async (record: GatewayRecord, body: (url: string) => Promise<void>) =>
        body(record.url),
      fetchWithin: async (_ms: number, _message: string, url: string, init: RequestInit) => {
        calls.push({ transport: 'HTTP', url, init });
        return response;
      },
      encryptedGatewayFetch: async (
        url: string,
        init: RequestInit,
        _ms: number,
        endpoint: unknown
      ) => {
        calls.push({ transport: 'encrypted', url, init, endpoint });
        return response;
      },
    }
  ) as (record: GatewayRecord, method: string, body: unknown) => Promise<void>;
  const record: GatewayRecord = {
    serverId: 'fixture',
    label: 'Fixture',
    token: 'fixture-credential',
    url: 'http://fixture.invalid',
    pairedAt: 1,
  };
  await write(record, 'POST', { token: 'fixture-token', platform: 'ios' });
  await write(
    {
      ...record,
      transport: 'muqun-aes-256-gcm-v1',
      deviceId: 'device',
      transportKey: 'fixture-key',
    },
    'DELETE',
    { token: 'fixture-token' }
  );
  expect(calls.map((call) => call.transport)).toEqual(['HTTP', 'encrypted']);
  expect(calls.every((call) => call.url === 'http://fixture.invalid/api/devices/push-token')).toBe(
    true
  );
  expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer fixture-credential' });
  expect(calls[1]!.endpoint).toMatchObject({ deviceId: 'device', transportKey: 'fixture-key' });
  response = { ...response, json: async () => ({ ok: false }) };
  await expect(write(record, 'POST', { token: 'fixture-token' })).rejects.toThrow(
    'unreadable push registration receipt'
  );
  expect(calls).toHaveLength(3);
});
