import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHotUpdaterAppConfig } from '../../scripts/hot-updater-app-config';

const root = mkdtempSync(join(tmpdir(), 'muqun-ota-config-'));
mkdirSync(join(root, 'keys'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('OTA native configuration boundary', () => {
  test('unconfigured builds are explicitly disabled and carry no client key', () => {
    expect(readHotUpdaterAppConfig({}, root)).toEqual({
      enabled: false,
      channel: 'development',
      clientApiKey: undefined,
      publicKeyPath: undefined,
    });
  });
  test('rejects unsupported channels', () => {
    expect(() => readHotUpdaterAppConfig({ HOT_UPDATER_CHANNEL: '../production' }, root)).toThrow(
      'HOT_UPDATER_CHANNEL'
    );
  });
  test('enabled builds require a registered client credential and public trust anchor', () => {
    expect(() => readHotUpdaterAppConfig({ EXPO_PUBLIC_HOT_UPDATER_ENABLED: '1' }, root)).toThrow(
      'registered'
    );
    expect(() =>
      readHotUpdaterAppConfig(
        { EXPO_PUBLIC_HOT_UPDATER_ENABLED: '1', EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'test-only' },
        root
      )
    ).toThrow();
  });
  test('accepts RSA SPKI public keys but refuses private keys', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = {
      EXPO_PUBLIC_HOT_UPDATER_ENABLED: '1',
      EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'test-only',
      HOT_UPDATER_CHANNEL: 'ota-test',
    };
    const path = join(root, 'keys/hot-updater-public.pem');
    writeFileSync(path, publicKey.export({ format: 'pem', type: 'spki' }));
    expect(readHotUpdaterAppConfig(env, root).enabled).toBe(true);
    writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    expect(() => readHotUpdaterAppConfig(env, root)).toThrow('never a private key');
  });
});
