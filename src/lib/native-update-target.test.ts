import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readNativeUpdateTarget,
  nativeUpdateDeployment,
  recordNativeUpdateTarget,
  withNativeUpdateFingerprint,
} from '../../scripts/native-update-target';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'muqun-native-target-'));
  roots.push(root);
  writeFileSync(join(root, 'build.aab'), 'android artifact');
  writeFileSync(join(root, 'build.ipa'), 'ios artifact');
  return root;
}
const fingerprint = (hash: string) => ({
  android: { sources: [], hash: hash.repeat(64) },
  ios: { sources: [], hash: hash.repeat(64) },
  inputs: { adapter: 'expo' },
});

test('native targets isolate channels and platforms and retain native inputs', () => {
  const root = setup();
  recordNativeUpdateTarget(root, 'preview', 'android', join(root, 'build.aab'), fingerprint('a'));
  recordNativeUpdateTarget(
    root,
    'production',
    'android',
    join(root, 'build.aab'),
    fingerprint('b')
  );
  recordNativeUpdateTarget(root, 'preview', 'ios', join(root, 'build.ipa'), fingerprint('c'));
  recordNativeUpdateTarget(root, 'preview', 'android', join(root, 'build.aab'), fingerprint('d'));
  expect(readNativeUpdateTarget(root, 'preview', 'android').fingerprintHash).toBe('d'.repeat(64));
  expect(readNativeUpdateTarget(root, 'production', 'android').fingerprintHash).toBe(
    'b'.repeat(64)
  );
  expect(readNativeUpdateTarget(root, 'preview', 'ios').fingerprint).toEqual(fingerprint('c'));
  expect(
    /^[a-f0-9]{64}$/.test(readNativeUpdateTarget(root, 'preview', 'android').artifact.sha256)
  ).toBe(true);
});

test('both-platform deploy uses each completed build and refuses missing or incompatible inputs', () => {
  const root = setup();
  recordNativeUpdateTarget(root, 'preview', 'android', join(root, 'build.aab'), fingerprint('a'));
  expect(() => nativeUpdateDeployment(root, 'preview', 'both')).toThrow('Build that channel');
  recordNativeUpdateTarget(root, 'preview', 'ios', join(root, 'build.ipa'), fingerprint('b'));
  const deployment = nativeUpdateDeployment(root, 'preview', 'both');
  expect(deployment.fingerprint).toEqual({
    android: fingerprint('a').android,
    ios: fingerprint('b').ios,
    inputs: { adapter: 'expo' },
  });
  expect(deployment.targets.map((target) => target.platform)).toEqual(['ios', 'android']);
  recordNativeUpdateTarget(root, 'preview', 'ios', join(root, 'build.ipa'), {
    ...fingerprint('b'),
    inputs: { adapter: 'bare' },
  });
  expect(() => nativeUpdateDeployment(root, 'preview', 'both')).toThrow('inputs differ');
});

test('missing and mismatched targets never select a root fingerprint or another channel', () => {
  const root = setup();
  writeFileSync(join(root, 'fingerprint.json'), JSON.stringify(fingerprint('b')));
  expect(() => readNativeUpdateTarget(root, 'preview', 'android')).toThrow('Build that channel');
  const path = recordNativeUpdateTarget(
    root,
    'preview',
    'android',
    join(root, 'build.aab'),
    fingerprint('a')
  );
  const target = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...target, channel: 'production' }));
  expect(() => readNativeUpdateTarget(root, 'preview', 'android')).toThrow('Invalid');
  writeFileSync(path, '{');
  expect(() => readNativeUpdateTarget(root, 'preview', 'android')).toThrow();
  expect(() => readNativeUpdateTarget(root, '../preview', 'android')).toThrow('Invalid');
});

test('invalid build results preserve the previously registered target', () => {
  const root = setup();
  recordNativeUpdateTarget(root, 'preview', 'android', join(root, 'build.aab'), fingerprint('a'));
  expect(() =>
    recordNativeUpdateTarget(root, 'preview', 'android', join(root, 'build.aab'), {})
  ).toThrow();
  expect(() =>
    recordNativeUpdateTarget(
      root,
      'preview',
      'android',
      join(root, 'missing.aab'),
      fingerprint('b')
    )
  ).toThrow();
  expect(readNativeUpdateTarget(root, 'preview', 'android').fingerprintHash).toBe('a'.repeat(64));
});

test('CLI staging restores original bytes on failure and rejects concurrent channel use', () => {
  const root = setup();
  const path = join(root, 'fingerprint.json');
  const original = '{"local": true}\n';
  writeFileSync(path, original);
  expect(() =>
    withNativeUpdateFingerprint(root, fingerprint('a'), () => {
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(fingerprint('a'));
      expect(() => withNativeUpdateFingerprint(root, fingerprint('b'), () => {})).toThrow('in use');
      throw new Error('CLI failed');
    })
  ).toThrow('CLI failed');
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(existsSync(join(root, '.hot-updater/native-deploy.lock'))).toBe(false);
  rmSync(path);
  expect(withNativeUpdateFingerprint(root, fingerprint('b'), () => 42)).toBe(42);
  expect(existsSync(path)).toBe(false);
});
