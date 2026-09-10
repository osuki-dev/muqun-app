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

function effect(serverId: string | null, enabled: boolean) {
  const calls: string[] = [];
  let cleanup: (() => void) | undefined;
  let foreground: ((state: string) => void) | undefined;
  const source = [
    declaration('src/lib/demo-gateway.ts', 'isDemoRecord'),
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
  return { calls, foreground: () => foreground?.('active'), cleanup: () => cleanup?.() };
}

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
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(run.calls).toEqual(['token lookup', 'listen', 'gateway register']);
  run.cleanup();
  expect(run.calls.at(-1)).toBe('unlisten');
});

test('real disabled notifications still unregister with the existing ownership flag', () => {
  expect(effect('paired-fixture', false).calls).toEqual(['unregister:true']);
  expect(effect(null, false).calls).toEqual(['unregister:false']);
  expect(effect(null, true).calls).toEqual([]);
});
