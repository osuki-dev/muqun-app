import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GatewayRecord } from '../gateway-storage';

function moduleSource(path: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  return source.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source).replace(/^export /, ''))
    .join('\n');
}
function evaluate(source: string, globals: Record<string, unknown>) {
  return runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }).outputText,
    globals
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const a: GatewayRecord = {
  serverId: 'a',
  label: 'A',
  url: 'https://a.invalid',
  token: 'a',
  pairedAt: 1,
};
const b: GatewayRecord = { ...a, serverId: 'b' };
type Snapshot = { record: GatewayRecord | null; records: GatewayRecord[] };
type State = Snapshot & {
  loading: boolean;
  hydrationError: string | null;
  hydrate: () => Promise<void>;
  setRecord: (record: GatewayRecord | null) => void;
};
function hydrationHarness() {
  const control = { read: async (): Promise<Snapshot> => ({ record: a, records: [a] }), reads: 0 };
  const configured: (GatewayRecord | null)[] = [];
  const timers = new Set<() => void>();
  let state!: State;
  evaluate(moduleSource('src/stores/gateway-connection.ts'), {
    create: (
      initialize: (
        set: (update: Partial<State> | ((state: State) => Partial<State>)) => void,
        get: () => State
      ) => State
    ) => {
      state = initialize(
        (update) => Object.assign(state, typeof update === 'function' ? update(state) : update),
        () => state
      );
      return state;
    },
    readGatewaySnapshot: () => {
      control.reads++;
      return control.read();
    },
    configureGateway: (record: GatewayRecord | null) => configured.push(record),
    setTimeout: (fn: () => void) => {
      timers.add(fn);
      return fn;
    },
    clearTimeout: (fn: () => void) => timers.delete(fn),
  });
  return { state, control, configured, expire: () => [...timers].forEach((fn) => fn()) };
}

test('failed hydration ends loading, preserves memory and permits explicit retry without an automatic loop', async () => {
  const h = hydrationHarness();
  h.state.setRecord(a);
  h.control.read = async () => {
    throw new Error('fixture keychain -34018');
  };
  await h.state.hydrate();
  expect(h.state.loading).toBe(false);
  expect(h.state.hydrationError).toBe('unavailable');
  expect(h.state.record).toBe(a);
  expect(h.state.records).toEqual([a]);
  expect(h.configured).toEqual([a]);
  expect(h.control.reads).toBe(1);
  h.control.read = async () => ({ record: b, records: [b] });
  await h.state.hydrate();
  expect(h.state.hydrationError).toBeNull();
  expect(h.state.record).toBe(b);
  expect(h.control.reads).toBe(2);
});
test('simultaneous hydration calls share one bounded read; late timed-out reads cannot overwrite retry', async () => {
  const h = hydrationHarness();
  const old = deferred<Snapshot>();
  h.control.read = () => old.promise;
  const first = h.state.hydrate();
  expect(h.state.hydrate()).toBe(first);
  expect(h.control.reads).toBe(1);
  h.expire();
  await first;
  expect(h.state.loading).toBe(false);
  expect(h.state.hydrationError).toBe('timeout');
  h.control.read = async () => ({ record: b, records: [b] });
  await h.state.hydrate();
  old.resolve({ record: a, records: [a] });
  await Promise.resolve();
  expect(h.state.record).toBe(b);
  expect(h.configured).toEqual([b]);
});
test('stale hydration success or failure cannot replace a newer selected record or introduce an error', async () => {
  for (const failure of [false, true]) {
    const h = hydrationHarness();
    const old = deferred<Snapshot>();
    h.control.read = () => old.promise;
    const pending = h.state.hydrate();
    h.state.setRecord(b);
    if (failure) old.reject(new Error('old error'));
    else old.resolve({ record: a, records: [a] });
    await pending;
    expect(h.state.record).toBe(b);
    expect(h.state.hydrationError).toBeNull();
    expect(h.state.loading).toBe(false);
    expect(h.configured).toEqual([b]);
  }
});

const keyName = 'muqun.gateway.encryption-key.v1';
const recordsName = 'muqun.gateway.records.v1';
const legacyName = 'muqun.gateway.current.v1';
function storageHarness() {
  const vault: Record<string, string> = {};
  const control = { failKey: '', writes: 0, deletes: 0 };
  const read = evaluate(moduleSource('src/lib/gateway-storage.ts') + '\nreadGatewaySnapshot', {
    QuickCrypto: { ...crypto, Buffer },
    SecureStore: {
      getItemAsync: async (key: string) => {
        if (key === control.failKey) throw new Error('keychain rejected');
        return vault[key] ?? null;
      },
      setItemAsync: () => {
        control.writes++;
        throw new Error('Unexpected write');
      },
      deleteItemAsync: () => {
        control.deletes++;
        throw new Error('Unexpected deletion');
      },
    },
  }) as () => Promise<Snapshot>;
  function seal(value: unknown, legacy = false) {
    const key = crypto.randomBytes(32),
      iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    vault[keyName] = key.toString('base64');
    vault[legacy ? legacyName : recordsName] = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: bytes.toString('base64'),
    });
  }
  return { vault, control, read, seal };
}
test('strict startup distinguishes genuine absence, modern data and legacy data without keychain writes', async () => {
  for (const format of ['absent', 'modern', 'legacy']) {
    const h = storageHarness();
    if (format !== 'absent') h.seal(format === 'legacy' ? a : [a], format === 'legacy');
    const before = JSON.stringify(h.vault);
    const result = await h.read();
    expect(result.records).toEqual(format === 'absent' ? [] : [a]);
    expect(JSON.stringify(h.vault)).toBe(before);
    expect(h.control.writes).toBe(0);
    expect(h.control.deletes).toBe(0);
  }
});
test('strict hydration rejects unavailable keys and corrupt encrypted data instead of pretending no servers exist', async () => {
  for (const failure of ['record-read', 'key-read', 'missing-key', 'ciphertext', 'shape']) {
    const h = storageHarness();
    h.seal(failure === 'shape' ? {} : [a]);
    if (failure === 'record-read') h.control.failKey = recordsName;
    if (failure === 'key-read') h.control.failKey = keyName;
    if (failure === 'missing-key') delete h.vault[keyName];
    if (failure === 'ciphertext') {
      const blob = JSON.parse(h.vault[recordsName]);
      blob.tag = Buffer.alloc(16).toString('base64');
      h.vault[recordsName] = JSON.stringify(blob);
    }
    const before = JSON.stringify(h.vault);
    await expect(h.read()).rejects.toThrow();
    expect(JSON.stringify(h.vault)).toBe(before);
    expect(h.control.writes).toBe(0);
    expect(h.control.deletes).toBe(0);
  }
});
test('Home cache pruning is disabled on hydration error, including after its spinner stops', () => {
  const path = 'src/app/(drawer)/index.tsx';
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let effect: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      node.arguments[0]?.getText(source).includes('keepServerAgents(serverIds)')
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!effect) throw new Error('Missing production cache effect');
  for (const hydrationError of [null, 'unavailable', 'timeout']) {
    const calls: string[] = [];
    evaluate(`(${effect.getText(source)})()`, {
      loading: false,
      hydrationError,
      serverIds: [],
      keepServerAgents: () => calls.push('agents'),
      keepReachability: () => calls.push('reachability'),
    });
    expect(calls).toHaveLength(hydrationError ? 0 : 2);
  }
});

test('storage errors take precedence over empty and not-found UI, with only explicit retry', () => {
  const home = readFileSync('src/app/(drawer)/index.tsx', 'utf8');
  const settings = readFileSync('src/components/settings-servers.tsx', 'utf8');
  const terminal = readFileSync('src/components/server-terminal-workspace.tsx', 'utf8');
  expect(home).toContain('!loading && !hydrationError && records.length === 0');
  expect(/hydrationError \? \(\s*<GatewayStorageError/.test(settings)).toBe(true);
  expect(terminal.indexOf('if (hydrationError)')).toBeLessThan(
    terminal.indexOf('if (!loading && !routeRecord)')
  );
  const h = hydrationHarness();
  const hook = evaluate(moduleSource('src/hooks/use-gateway-record.ts') + '\nuseGatewayRecord', {
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void) => effect(),
    useGatewayConnectionStore: (select: (state: State) => unknown) => select(h.state),
    useSessionControlStore: (select: (state: { reset: () => void }) => unknown) =>
      select({ reset() {} }),
  }) as () => void;
  h.state.loading = false;
  h.state.hydrationError = 'unavailable';
  hook();
  hook();
  expect(h.control.reads).toBe(0);
});
