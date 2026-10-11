import type { ConfigContext, ExpoConfig } from 'expo/config';
import { readHotUpdaterAppConfig } from './scripts/hot-updater-app-config.ts';

export default ({ config }: ConfigContext): ExpoConfig => {
  const ota = readHotUpdaterAppConfig(process.env, process.cwd());
  return {
    ...config,
    name: config.name ?? 'Muqun',
    slug: config.slug ?? 'muqun',
    plugins: [
      ...(config.plugins ?? []),
      [
        '@hot-updater/expo',
        {
          channel: ota.channel,
          ...(ota.publicKeyPath ? { publicKeyPath: ota.publicKeyPath } : {}),
        },
      ],
    ],
    extra: {
      ...config.extra,
      hotUpdater: { enabled: ota.enabled, clientApiKey: ota.clientApiKey },
    },
  };
};
