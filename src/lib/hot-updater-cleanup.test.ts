import { expect, test } from 'bun:test';
import {
  AndroidConfig,
  IOSConfig,
  type ConfigPlugin,
  type ExportedConfig,
} from 'expo/config-plugins';
import { createRequire } from 'node:module';

const requirePlugin = createRequire(import.meta.url);
const cleanup = requirePlugin('../../plugins/with-hot-updater-cleanup.js') as ConfigPlugin;
const base = {
  name: 'Cleanup test',
  slug: 'cleanup-test',
  _internal: { projectRoot: process.cwd() },
};
const request = {
  projectRoot: process.cwd(),
  platformProjectRoot: process.cwd(),
  introspect: true,
};

test('Android cleanup runs after SDK defaults and preserves unrelated and Hot Updater metadata', async () => {
  // Prebuild registers the app plugins first, then its own SDK defaults.
  const config: ExportedConfig = AndroidConfig.Updates.withUpdates(cleanup({ ...base }));
  const run = config.mods?.android?.manifest;
  if (!run) throw new Error('Android manifest mod missing');
  const keep = [
    { $: { 'android:name': 'HOT_UPDATER_CHANNEL', 'android:value': 'ota-test' } },
    { $: { 'android:name': 'unrelated.example', 'android:value': 'keep' } },
  ];
  const result = await run({
    ...config,
    modRawConfig: base,
    modRequest: { ...request, platform: 'android', modName: 'manifest' },
    modResults: {
      manifest: {
        $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
        queries: [],
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            'meta-data': [
              ...keep,
              { $: { 'android:name': 'expo.modules.updates.OLD_VALUE', 'android:value': 'old' } },
            ],
          },
        ],
      },
    },
  });
  expect(result.modResults.manifest.application?.[0]['meta-data']).toEqual(keep);
});

test('iOS cleanup runs after SDK defaults and preserves unrelated Expo plist entries', async () => {
  const config: ExportedConfig = IOSConfig.Updates.withUpdates(cleanup({ ...base }));
  const run = config.mods?.ios?.expoPlist;
  if (!run) throw new Error('Expo plist mod missing');
  const result = await run({
    ...config,
    modRawConfig: base,
    modRequest: { ...request, platform: 'ios', modName: 'expoPlist' },
    modResults: { EXUpdatesEnabled: true, unrelated: 'keep' },
  });
  expect(result.modResults).toEqual({ unrelated: 'keep' });
});
