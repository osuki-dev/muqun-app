import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHotUpdaterAppConfig } from '../../scripts/hot-updater-app-config';

const root = mkdtempSync(join(tmpdir(), 'muqun-ota-config-'));
mkdirSync(join(root, 'keys'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('OTA native configuration boundary', () => {
  test('native packaging does not load provider credentials from the local deployment file', () => {
    writeFileSync(
      join(root, '.env.hotupdater'),
      'HOT_UPDATER_CLOUDFLARE_API_TOKEN=must-not-enter-native-build\n'
    );
    const configPath = fileURLToPath(new URL('../../hot-updater.config.ts', import.meta.url));
    const script = `delete process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
      const {default: config} = await import(${JSON.stringify(configPath)});
      let deploymentBlocked = false;
      try { config({}); } catch { deploymentBlocked = true; }
      console.log(JSON.stringify({ loaded: !!process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN, deploymentBlocked }));`;
    const result = spawnSync(process.execPath, ['--eval', script], {
      cwd: root,
      env: { ...process.env, HOT_UPDATER_NATIVE_BUILD: '1' },
      encoding: 'utf8',
    });
    rmSync(join(root, '.env.hotupdater'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ loaded: false, deploymentBlocked: true });
  });
  test('CLI config retains signing and a usable default path with a blank environment value', () => {
    const configPath = fileURLToPath(new URL('../../hot-updater.config.ts', import.meta.url));
    const script = `const { default: config } = await import(${JSON.stringify(configPath)});
      console.log(JSON.stringify(config(null).signing));`;
    for (const value of ['', '   ', '/private/real-signer.pem']) {
      const result = spawnSync(process.execPath, ['--eval', script], {
        cwd: root,
        env: { ...process.env, HOT_UPDATER_SIGNING_PRIVATE_KEY_PATH: value },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        enabled: true,
        privateKeyPath: value.trim() || './keys/private-key.pem',
      });
    }
  });
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
