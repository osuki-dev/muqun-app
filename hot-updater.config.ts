import { d1Database, r2Storage } from '@hot-updater/cloudflare';
import { expo } from '@hot-updater/expo';
import { defineConfig } from 'hot-updater';
import { apiKeys, insights, remoteConfig } from 'hot-updater/plugins';
import { existsSync } from 'node:fs';
import { localizedReleaseNotes } from './infrastructure/ota-notes/plugin';

// Native packaging needs the public trust anchor only, never provider or signer secrets.
if (process.env.HOT_UPDATER_NATIVE_BUILD !== '1' && existsSync('.env.hotupdater')) {
  process.loadEnvFile('.env.hotupdater');
}

const accountId = process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID;
const cloudflareApiToken = process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN;
const bucketName = process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME;
const accessKeyId = process.env.HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY;

export default defineConfig((options) => {
  if (
    options &&
    (!accountId ||
      !databaseId ||
      !cloudflareApiToken ||
      !bucketName ||
      !accessKeyId ||
      !secretAccessKey)
  ) {
    throw new Error('Hot Updater deployment requires configured Cloudflare credentials');
  }
  return {
    build: expo({ outDir: 'dist/hot-updater', sourcemap: false }),
    updateStrategy: 'fingerprint',
    fingerprint: {
      extraSources: [
        'app.json',
        'app.config.ts',
        'scripts/hot-updater-app-config.ts',
        'plugins/**/*.{js,cjs}',
        // Extra-source globs bypass SDK build-output ignores. Name source roots
        // explicitly so a native build cannot add generated XML/JSON to the hash.
        'modules/theme-transport/*.json',
        'modules/theme-transport/ios/**/*.{swift,podspec}',
        'modules/theme-transport/android/*.gradle',
        'modules/theme-transport/android/src/**/*.{kt,java,xml}',
        'patches/*.patch',
      ],
    },
    // Native prebuild/fingerprint needs no deployment credentials. The deploy wrapper
    // requires every credential before invoking the CLI; missing adapters cannot publish.
    database: d1Database({
      accountId: accountId ?? '',
      databaseId: databaseId ?? '',
      cloudflareApiToken: cloudflareApiToken ?? '',
    }),
    storage: r2Storage({
      accountId: accountId ?? '',
      bucketName: bucketName ?? '',
      credentials: { accessKeyId: accessKeyId ?? '', secretAccessKey: secretAccessKey ?? '' },
    }),
    plugins: [apiKeys(), insights(), remoteConfig(), localizedReleaseNotes()],
    signing: {
      enabled: true,
      privateKeyPath:
        process.env.HOT_UPDATER_SIGNING_PRIVATE_KEY_PATH?.trim() || './keys/private-key.pem',
    },
  };
});
