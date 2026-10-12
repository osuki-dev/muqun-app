import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1Database, r2Storage } from '@hot-updater/cloudflare';
import { createHotUpdater } from '@hot-updater/server';
import { apiKeys, insights, remoteConfig } from '@hot-updater/server/plugins';
import { localizedReleaseNotes } from '../infrastructure/ota-notes/plugin';
import { parseOtaNotesManifest } from '../infrastructure/ota-notes/manifest';
import { fetchOtaReleaseNote } from '../src/lib/ota-release-notes';
import { deployedOtaReleaseId, publishOtaNotesAndEnable } from './publish-ota-notes';
import { readHotUpdaterAppConfig } from './hot-updater-app-config';

if (existsSync('.env.hotupdater')) process.loadEnvFile('.env.hotupdater');
const channel = process.argv[2];
const platform = process.argv[3];
const notesPath = process.argv[4];
if (
  !['preview', 'production', 'ota-test'].includes(channel ?? '') ||
  !['android', 'ios'].includes(platform ?? '') ||
  !notesPath ||
  process.argv.length !== 5
) {
  throw new Error(
    'Usage: bun scripts/deploy-hot-update.ts <preview|production|ota-test> <android|ios> <notes.json>'
  );
}
// Validate every translation before invoking the CLI or touching remote state.
const notes = parseOtaNotesManifest(JSON.parse(readFileSync(notesPath, 'utf8')));
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
const fingerprint: unknown = JSON.parse(readFileSync('fingerprint.json', 'utf8'));
if (
  !fingerprint ||
  typeof fingerprint !== 'object' ||
  !('hash' in fingerprint) ||
  typeof fingerprint.hash !== 'string' ||
  !fingerprint.hash
)
  throw new Error('Invalid native release fingerprint');
const server = createHotUpdater({
  database: d1Database({
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: process.env.HOT_UPDATER_CLOUDFLARE_D1_DATABASE_ID ?? '',
    cloudflareApiToken: process.env.HOT_UPDATER_CLOUDFLARE_API_TOKEN ?? '',
  }),
  storage: r2Storage({
    accountId: process.env.HOT_UPDATER_CLOUDFLARE_ACCOUNT_ID ?? '',
    bucketName: process.env.HOT_UPDATER_CLOUDFLARE_R2_BUCKET_NAME ?? '',
    credentials: {
      accessKeyId: process.env.HOT_UPDATER_CLOUDFLARE_R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.HOT_UPDATER_CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '',
    },
  }),
  plugins: [apiKeys(), insights(), remoteConfig(), localizedReleaseNotes()],
});
// Build/provider output can contain secrets. Capture privately, expose only the receipt.
const workspace = mkdtempSync(join(tmpdir(), 'muqun-ota-'));
let releaseId: string | null = null;
let phase = 'schema preflight';
try {
  await server.core.ready();
  phase = 'disabled deployment';
  console.log('Building and deploying a disabled OTA release.');
  const logPath = join(workspace, 'deploy.log');
  const log = openSync(logPath, 'wx', 0o600);
  let result;
  try {
    // No auto-regeneration: native changes must be reviewed and built before OTA.
    result = spawnSync(
      'bunx',
      [
        '--no-install',
        'hot-updater',
        'deploy',
        '--platform',
        platform ?? '',
        '--channel',
        channel ?? '',
        '--disabled',
        '--message',
        notes.en,
      ],
      { stdio: ['ignore', log, log] }
    );
  } finally {
    closeSync(log);
  }
  if (result.error || result.status !== 0) throw new Error('Disabled deployment failed');
  releaseId = deployedOtaReleaseId(readFileSync(logPath, 'utf8'));
  console.log(`Disabled OTA release: ${releaseId}`);
  phase = 'notes verification and guarded enablement';
  await publishOtaNotesAndEnable(
    server.core,
    {
      publish: server.api.localized_release_notes.publish,
      get: (id, locale) =>
        fetchOtaReleaseNote(id, locale, process.env.EXPO_PUBLIC_HOT_UPDATER_API_KEY ?? ''),
    },
    releaseId,
    notes,
    {
      channel: channel ?? '',
      platform: platform === 'ios' ? 'ios' : 'android',
      fingerprintHash: fingerprint.hash,
    }
  );
  console.log(`Enabled OTA release with verified notes: ${releaseId}`);
} catch {
  console.error(
    `OTA publication failed during ${phase}. No automatic retry was attempted.${releaseId ? ` Inspect release ${releaseId} before retrying.` : ' Inspect deployment state before retrying.'}`
  );
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
  await server.flush();
  await server.database.dispose?.();
}
