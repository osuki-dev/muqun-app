import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';

/** Execute the actual production effect with inert native/network ports. No
 * React Native imports, global module mocks, devices or push credentials. */
function declaration(path: string, name: string): string {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const node = source.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === name
  );
  if (!node) throw new Error(`Missing production function ${name}`);
  return node.getText(source).replace(/^export /, '');
}

/**
 * The persisted "what this device already told this server" store, faked as a
 * map so a test can hand the same one to two runs of the effect and watch the
 * second stay silent -- which is the whole point of the rule.
 */
type TokenStore = Map<string, { token: string; build: string }>;

function effect(
  serverId: string | null,
  enabled: boolean,
  store: TokenStore = new Map(),
  options: { refuse?: boolean } = {}
) {
  const calls: string[] = [];
  let cleanup: (() => void) | undefined;
  let foreground: ((state: string) => void) | undefined;
  const source = [
    declaration('src/lib/demo-gateway.ts', 'isDemoRecord'),
    // The real rule and the real build identity, not restatements of them: a
    // test that re-implemented either would pass while production drifted.
    declaration('src/lib/push-token-registry.ts', 'pushTokenNeedsSending'),
    declaration('src/lib/notifications.ts', 'appBuildIdentity'),
    declaration('src/lib/notifications.ts', 'useGatewayPushRegistration'),
    'useGatewayPushRegistration(record);',
  ].join('\n');
  const script = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  runInNewContext(script, {
    DEMO_SERVER_ID: DEMO_PAIRING_SERVER_ID,
    record: serverId === null ? null : { serverId },
    useAppSettings: (selector: (state: { notificationsEnabled: boolean }) => unknown) =>
      selector({ notificationsEnabled: enabled }),
    useEffect: (body: () => (() => void) | undefined) => {
      cleanup = body();
    },
    registerForPushNotificationsAsync: async () => {
      calls.push('token lookup');
      return 'fixture-token';
    },
    registerDevicePushToken: async () => {
      calls.push('gateway register');
      if (options.refuse) throw new Error('gateway refused the token');
    },
    Application: { nativeApplicationVersion: '3.0.0', nativeBuildVersion: '41' },
    registeredPushToken: (id: string) => store.get(id) ?? null,
    rememberRegisteredPushToken: (id: string, entry: { token: string; build: string }) => {
      calls.push('remember');
      store.set(id, entry);
    },
    unregisterPushNotificationsAsync: async (remove: boolean) => {
      calls.push(`unregister:${remove}`);
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
  });
  return {
    calls,
    store,
    foreground: () => foreground?.('active'),
    cleanup: () => cleanup?.(),
  };
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
  expect(run.calls).toEqual(['token lookup', 'listen', 'gateway register', 'remember']);
  run.cleanup();
  expect(run.calls.at(-1)).toBe('unlisten');
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
  expect(second.calls).toEqual(['token lookup', 'listen']);
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

test('real disabled notifications still unregister with the existing ownership flag', () => {
  expect(effect('paired-fixture', false).calls).toEqual(['unregister:true']);
  expect(effect(null, false).calls).toEqual(['unregister:false']);
  expect(effect(null, true).calls).toEqual([]);
});
