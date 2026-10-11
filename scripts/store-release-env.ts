export type StoreChannel = 'preview' | 'production';

export function storeReleaseEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  local: Readonly<Record<string, string | undefined>>,
  channel: StoreChannel
): Record<string, string | undefined> & { NODE_ENV: 'production' } {
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([name]) => !/^(HOT_UPDATER_|CLOUDFLARE_|CF_|R2_|AWS_)/.test(name)
    )
  );
  return {
    ...env,
    NODE_USE_ENV_PROXY: '1',
    NODE_ENV: 'production',
    HOT_UPDATER_NATIVE_BUILD: '1',
    HOT_UPDATER_CHANNEL: channel,
    EXPO_PUBLIC_HOT_UPDATER_ENABLED: '1',
    EXPO_PUBLIC_HOT_UPDATER_API_KEY:
      inherited.EXPO_PUBLIC_HOT_UPDATER_API_KEY || local.EXPO_PUBLIC_HOT_UPDATER_API_KEY,
  };
}
