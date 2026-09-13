import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { AbortController as RNAbortController } from 'abort-controller/dist/abort-controller';
import { abortThemeOperation, themeAbortReason, throwIfThemeAborted } from '../abort';
import { createPublicThemeTransport } from '../transport-bridge';

function controller(): AbortController {
  // Match the exact module loaded by React Native's setUpXHR, not Bun's globals.
  return new RNAbortController() as unknown as AbortController;
}

test('installed RN polyfill supports portable cancellation without prototype changes', () => {
  const current = controller();
  expect(current.signal.throwIfAborted).toBeUndefined();
  expect(current.signal.reason).toBeUndefined();
  expect(() => throwIfThemeAborted(current.signal)).not.toThrow();
  current.abort();
  expect(() => throwIfThemeAborted(current.signal)).toThrow('Theme operation canceled');
  expect(themeAbortReason(current.signal)).toMatchObject({ name: 'AbortError' });
  expect(current.signal.throwIfAborted).toBeUndefined();
});

test('owned timeout reason survives RN dropping abort arguments and cannot be replaced', () => {
  const current = controller();
  const timeout = new Error('Theme download timed out');
  abortThemeOperation(current, timeout);
  abortThemeOperation(current, new Error('Later cancellation'));
  expect(current.signal.reason).toBeUndefined();
  expect(themeAbortReason(current.signal)).toBe(timeout);
  expect(() => throwIfThemeAborted(current.signal)).toThrow(timeout);
});

test('native bridge cancels pending work and rejects an Error under the RN polyfill', async () => {
  const current = controller();
  const canceled: string[] = [];
  const transport = createPublicThemeTransport(
    {
      contractVersion: 1,
      get: () => new Promise(() => {}),
      cancel: (id) => {
        canceled.push(id);
      },
    },
    () => 'isolated-fixture'
  );
  const pending = transport!.get('https://example.com/theme.json', {
    signal: current.signal,
    maxBytes: 1024,
  });
  current.abort();
  expect(await pending.catch((error: unknown) => error)).toMatchObject({ name: 'AbortError' });
  expect(canceled).toEqual(['isolated-fixture']);
  await expect(
    transport!.get('https://example.com/theme.json', {
      signal: current.signal,
      maxBytes: 1024,
    })
  ).rejects.toThrow('Theme operation canceled');
  expect(canceled).toHaveLength(1);
});

test('portable helper also runs in Node with the actual RN polyfill', () => {
  const result = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { abortThemeOperation, themeAbortReason, throwIfThemeAborted } from './src/theme/abort.ts';
    const require = createRequire(import.meta.url);
    const { AbortController } = require('abort-controller/dist/abort-controller');
    const active = new AbortController();
    assert.equal(active.signal.throwIfAborted, undefined);
    throwIfThemeAborted(active.signal);
    const reason = new Error('Owned timeout');
    abortThemeOperation(active, reason);
    assert.equal(themeAbortReason(active.signal), reason);
    assert.throws(() => throwIfThemeAborted(active.signal), reason);
    const canceled = new AbortController(); canceled.abort();
    assert.equal(themeAbortReason(canceled.signal).name, 'AbortError');
    process.stdout.write('RN polyfill passed');
  `,
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  expect(result).toBe('RN polyfill passed');
});
