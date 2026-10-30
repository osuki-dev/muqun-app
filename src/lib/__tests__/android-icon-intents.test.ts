import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import {
  AndroidConfig,
  type AndroidManifest,
  type ConfigPlugin,
  type ExportedConfig,
} from 'expo/config-plugins';
import { withAndroidManifestUpdate } from 'expo-alternate-app-icons/plugin/build/android/withAndroidManifestUpdate';

const loadPlugin = createRequire(import.meta.url);
const withAndroidIconIntents = loadPlugin(
  '../../../plugins/with-android-icon-intents.js'
) as ConfigPlugin;
const actionPrefix = 'android.intent.action.';
const categoryPrefix = 'android.intent.category.';

const config: ExportedConfig = {
  name: 'Muqun',
  slug: 'muqun',
  android: {
    package: 'dev.osuki.muqun',
    intentFilters: [
      { action: 'VIEW', category: ['DEFAULT', 'BROWSABLE'], data: { scheme: 'muqun' } },
      {
        action: 'VIEW',
        category: ['DEFAULT'],
        data: { scheme: 'content', mimeType: 'application/pdf' },
      },
      { action: 'SEND', category: ['DEFAULT'], data: { mimeType: 'text/plain' } },
    ],
  },
};

function manifestFixture(): AndroidManifest {
  return AndroidConfig.IntentFilters.setAndroidIntentFilters(config, {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [
                {
                  action: [{ $: { 'android:name': `${actionPrefix}MAIN` } }],
                  category: [{ $: { 'android:name': `${categoryPrefix}LAUNCHER` } }],
                },
              ],
            },
          ],
          'activity-alias': [
            {
              $: {
                'android:name': '.ExternalAlias',
                'android:targetActivity': '.ExternalActivity',
              },
              'intent-filter': [{ action: [{ $: { 'android:name': `${actionPrefix}VIEW` } }] }],
            },
          ],
        },
      ],
    },
  });
}

async function generatedManifest(fix: boolean) {
  let generated = withAndroidManifestUpdate(structuredClone(config), ['Classic']) as ExportedConfig;
  if (fix) generated = withAndroidIconIntents(generated) as ExportedConfig;
  const manifestMod = generated.mods?.android?.manifest;
  if (!manifestMod) throw new Error('Android manifest mod was not registered');
  const result = await manifestMod({
    ...generated,
    modResults: manifestFixture(),
    modRawConfig: config,
    modRequest: {
      platform: 'android',
      modName: 'manifest',
      projectRoot: process.cwd(),
      platformProjectRoot: `${process.cwd()}/android`,
      introspect: true,
    },
  });
  return result.modResults as AndroidManifest;
}

function receivers(manifest: AndroidManifest, activeIcon: string, action: string) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const activeAlias = application['activity-alias']?.find(
    (alias) => alias.$?.['android:name'] === `.MainActivity${activeIcon}`
  );
  return [mainActivity, activeAlias]
    .filter((component) =>
      component?.['intent-filter']?.some((filter) =>
        filter.action?.some((entry) => entry.$['android:name'] === `${actionPrefix}${action}`)
      )
    )
    .map((component) => component?.$?.['android:name']);
}

describe('Android icon alias intent boundary', () => {
  test('real icon plugin output has one link, file and share receiver with Default or Classic active', async () => {
    const before = await generatedManifest(false);
    const after = await generatedManifest(true);
    for (const icon of ['Default', 'Classic']) {
      expect(receivers(before, icon, 'VIEW')).toHaveLength(2);
      expect(receivers(before, icon, 'SEND')).toHaveLength(2);
      expect(receivers(after, icon, 'VIEW')).toEqual(['.MainActivity']);
      expect(receivers(after, icon, 'SEND')).toEqual(['.MainActivity']);
      expect(receivers(after, icon, 'MAIN')).toEqual([`.MainActivity${icon}`]);
    }
    expect(AndroidConfig.Manifest.getMainActivityOrThrow(after)).toEqual(
      AndroidConfig.Manifest.getMainActivityOrThrow(before)
    );
  });

  test('preserves icon alias identity and unrelated activity aliases', async () => {
    const before = AndroidConfig.Manifest.getMainApplicationOrThrow(await generatedManifest(false));
    const after = AndroidConfig.Manifest.getMainApplicationOrThrow(await generatedManifest(true));
    expect(after['activity-alias']?.map((alias) => alias.$)).toEqual(
      before['activity-alias']?.map((alias) => alias.$)
    );
    expect(
      after['activity-alias']?.find((alias) => alias.$?.['android:name'] === '.ExternalAlias')
    ).toEqual(
      before['activity-alias']?.find((alias) => alias.$?.['android:name'] === '.ExternalAlias')
    );
  });
});
