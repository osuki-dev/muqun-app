import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readHotUpdaterAppConfig } from './hot-updater-app-config';

if (existsSync('.env.hotupdater')) process.loadEnvFile('.env.hotupdater');
const channel = process.argv[2];
const platform = process.argv[3];
if (
  !['preview', 'production', 'ota-test'].includes(channel ?? '') ||
  !['android', 'ios'].includes(platform ?? '')
) {
  throw new Error(
    'Usage: bun scripts/deploy-hot-update.ts <preview|production|ota-test> <android|ios>'
  );
}
const required = [
  'HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID',
  'HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID',
  'HOT_UPDATER_CLOUDFLARE_API_TOKEN',
  'HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME',
  'HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID',
  'HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'HOT_UPDATER_SIGNING_PRIVATE_KEY_PATH',
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing deployment variable: ${name}`);
}
if (process.env.EXPO_PUBLIC_HOT_UPDATER_ENABLED !== '1')
  throw new Error('OTA must be explicitly enabled for deployment');
if (process.env.HOT_UPDATER_CHANNEL !== channel)
  throw new Error('Build and deployment channels must match');
readHotUpdaterAppConfig(process.env, process.cwd());
if (!existsSync('fingerprint.json'))
  throw new Error('Missing fingerprint.json from the corresponding native release build');
// No auto-regeneration: native changes must be reviewed and built before OTA.
const result = spawnSync(
  'bunx',
  [
    '--no-install',
    'hot-updater',
    'deploy',
    '--platform',
    platform ?? '',
    '--channel',
    channel ?? '',
  ],
  { stdio: 'inherit' }
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
