import { expect, test } from 'bun:test';
import type { ThemeTransportModule } from '../../../modules/theme-transport/src/MuqunThemeTransport.types';
import { createPublicThemeTransport } from '../transport-bridge';
import { THEME_LIMITS } from '../schema';

function fixture() {
  const calls: string[] = [];
  const canceled: string[] = [];
  const native: ThemeTransportModule = {
    contractVersion: 1,
    async get(id) {
      calls.push(id);
      return { status: 200, bytes: new Uint8Array([1]) };
    },
    cancel(id) {
      canceled.push(id);
    },
  };
  let count = 0;
  return {
    native,
    calls,
    canceled,
    transport: createPublicThemeTransport(native, () => `request-${++count}`)!,
  };
}

const options = () => ({ signal: new AbortController().signal, maxBytes: 1024 });
const url = 'https://example.com/theme.json';

test('old or missing native implementation is unavailable without fallback networking', () => {
  expect(createPublicThemeTransport(null, () => 'unused')).toBeNull();
  expect(
    createPublicThemeTransport({ ...fixture().native, contractVersion: 2 }, () => 'unused')
  ).toBeNull();
});

test('requests have separate identities; unsafe URLs and budgets never reach native', async () => {
  const f = fixture();
  await f.transport.get(url, options());
  await f.transport.get(url, options());
  expect(f.calls).toEqual(['request-1', 'request-2']);
  for (const maxBytes of [0, -1, 0.5, Infinity, THEME_LIMITS.packageBytes + 1])
    await expect(f.transport.get(url, { ...options(), maxBytes })).rejects.toThrow('budget');
  await expect(f.transport.get('https://127.0.0.1/', options())).rejects.toThrow();
  expect(f.calls).toHaveLength(2);
});

test('abort before dispatch never calls native; in-flight cancellation settles even if native hangs', async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort(new Error('Stopped'));
  await expect(f.transport.get(url, { ...options(), signal: controller.signal })).rejects.toThrow(
    'Stopped'
  );
  expect(f.calls).toHaveLength(0);
  const live = new AbortController();
  f.native.get = () => new Promise(() => {});
  const pending = f.transport.get(url, { ...options(), signal: live.signal });
  live.abort(new Error('Stopped'));
  await expect(pending).rejects.toThrow('Stopped');
  expect(f.canceled).toEqual(['request-1']);
});

test('abort during native dispatch is detected and cancellation exceptions do not escape', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.native.get = () => {
    controller.abort(new Error('Stopped'));
    return new Promise(() => {});
  };
  f.native.cancel = () => {
    throw new Error('Runtime gone');
  };
  await expect(f.transport.get(url, { ...options(), signal: controller.signal })).rejects.toThrow(
    'Stopped'
  );
});

test('native response shape and byte budgets are verified before returning data', async () => {
  const f = fixture();
  for (const response of [
    { status: 99, bytes: new Uint8Array() },
    { status: 200, bytes: new Uint8Array(1025) },
    { status: 200, bytes: new Uint8Array(), location: 'x'.repeat(2049) },
    { status: 200, bytes: new Uint8Array(), contentType: 'x'.repeat(1025) },
  ]) {
    f.native.get = async () => response;
    await expect(f.transport.get(url, options())).rejects.toThrow('Invalid native');
  }
});

test('completed requests release abort listeners and failed requests are not retried', async () => {
  const f = fixture();
  const controller = new AbortController();
  await f.transport.get(url, { ...options(), signal: controller.signal });
  controller.abort();
  expect(f.canceled).toEqual([]);
  f.native.get = async (id) => {
    f.calls.push(id);
    throw new Error('Offline');
  };
  await expect(f.transport.get(url, options())).rejects.toThrow('Offline');
  expect(f.calls).toEqual(['request-1', 'request-2']);
});
