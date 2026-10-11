import { expect, test } from 'bun:test';
import { playPreviewEnvironment } from '../../scripts/play-preview-env';

test('native packaging receives public OTA settings without provider or signing credentials', () => {
  const env = playPreviewEnvironment(
    {
      PATH: '/usr/bin',
      EXPO_TOKEN: 'expo-session-only',
      HOT_UPDATER_SIGNING_PRIVATE_KEY_PATH: '/private/signer.pem',
      HOT_UPDATER_CLOUDFLARE_API_TOKEN: 'provider-secret',
      CLOUDFLARE_API_TOKEN: 'provider-secret',
      R2_SECRET_ACCESS_KEY: 'storage-secret',
      AWS_SECRET_ACCESS_KEY: 'storage-secret',
      HOT_UPDATER_CHANNEL: 'production',
      EXPO_PUBLIC_HOT_UPDATER_ENABLED: '0',
    },
    {
      EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'public-client-credential',
      HOT_UPDATER_CLOUDFLARE_API_TOKEN: 'local-provider-secret',
    }
  );
  expect(env).toEqual({
    PATH: '/usr/bin',
    EXPO_TOKEN: 'expo-session-only',
    NODE_USE_ENV_PROXY: '1',
    NODE_ENV: 'production',
    HOT_UPDATER_NATIVE_BUILD: '1',
    HOT_UPDATER_CHANNEL: 'preview',
    EXPO_PUBLIC_HOT_UPDATER_ENABLED: '1',
    EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'public-client-credential',
  });
});

test('an explicit public client credential takes precedence over local configuration', () => {
  expect(
    playPreviewEnvironment(
      { EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'explicit-client' },
      { EXPO_PUBLIC_HOT_UPDATER_API_KEY: 'local-client' }
    ).EXPO_PUBLIC_HOT_UPDATER_API_KEY
  ).toBe('explicit-client');
});
