import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d1Database, r2Storage } from '@hot-updater/cloudflare';
import { createHotUpdater } from '@hot-updater/server';
import { apiKeys, insights, remoteConfig } from '@hot-updater/server/plugins';
import { localizedReleaseNotes } from '../infrastructure/ota-notes/plugin';
import { parseOtaNotesManifest } from '../infrastructure/ota-notes/manifest';
import { fetchOtaReleaseNote } from '../src/lib/ota-release-notes';
import {
  deployedOtaReleaseIds,
  finishOtaPublication,
  prepareOtaNotesEnablement,
  recordOtaPublicationFailure,
} from './publish-ota-notes';
import { nativeUpdateDeployment, withNativeUpdateFingerprint } from './native-update-target';
import { readHotUpdaterAppConfig } from './hot-updater-app-config';

if (existsSync('.env.hotupdater')) process.loadEnvFile('.env.hotupdater');
const channel = process.argv[2];
const platform = process.argv[3];
const notesPath = process.argv[4];
if (
  !['preview', 'production', 'ota-test'].includes(channel ?? '') ||
  !['android', 'ios', 'both'].includes(platform ?? '') ||
  !notesPath ||
  process.argv.length !== 5
) {
  throw new Error(
    'Usage: bun scripts/deploy-hot-update.ts <preview|production|ota-test> <android|ios|both> <notes.json>'
  );
}
// Validate every translation before invoking the CLI or touching remote state.
const notes = parseOtaNotesManifest(JSON.parse(readFileSync(notesPath, 'utf8')));
const selectedPlatform = platform === 'both' ? 'both' : platform === 'ios' ? 'ios' : 'android';
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
// Reject missing or stale source catalogs, then bundle their compiled translations.
for (const script of ['i18n:check', 'i18n:compile']) {
  const result = spawnSync('bun', ['run', script], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`OTA localization preflight failed: ${script}`);
}
const deployment = nativeUpdateDeployment(process.cwd(), channel ?? '', selectedPlatform);
for (const target of deployment.targets) {
  console.log(
    `OTA target: ${channel}/${target.platform} — ${target.artifact.name} — ${target.fingerprintHash}`
  );
}
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
const logPath = join(workspace, 'deploy.log');
closeSync(openSync(logPath, 'wx', 0o600));
let receipts: { platform: 'ios' | 'android'; releaseId: string }[] = [];
let phase = 'schema preflight';
let succeeded = false;
try {
  await server.core.ready();
  phase = 'disabled deployment';
  console.log('Building and deploying a disabled OTA release.');
  const log = openSync(logPath, 'a', 0o600);
  let result;
  try {
    // No auto-regeneration: native changes must be reviewed and built before OTA.
    result = withNativeUpdateFingerprint(process.cwd(), deployment.fingerprint, () =>
      spawnSync(
        'bunx',
        [
          '--no-install',
          'hot-updater',
          'deploy',
          ...(selectedPlatform === 'both' ? [] : ['--platform', selectedPlatform]),
          '--channel',
          channel ?? '',
          '--disabled',
          '--message',
          notes.en,
        ],
        { stdio: ['ignore', log, log] }
      )
    );
  } finally {
    closeSync(log);
  }
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Disabled deployment failed (exit ${result.status ?? 'unknown'})`);
  receipts = deployedOtaReleaseIds(
    readFileSync(logPath, 'utf8'),
    deployment.targets.map((target) => target.platform)
  );
  for (const receipt of receipts)
    console.log(`Disabled OTA release (${receipt.platform}): ${receipt.releaseId}`);
  phase = 'notes verification';
  const enablements: { platform: string; releaseId: string; enable: () => Promise<void> }[] = [];
  for (const receipt of receipts) {
    const target = deployment.targets.find((candidate) => candidate.platform === receipt.platform);
    if (!target) throw new Error('Unexpected platform in deployment receipt');
    const enable = await prepareOtaNotesEnablement(
      server.core,
      {
        publish: server.api.localized_release_notes.publish,
        get: (id, locale) =>
          fetchOtaReleaseNote(id, locale, process.env.EXPO_PUBLIC_HOT_UPDATER_API_KEY ?? ''),
      },
      receipt.releaseId,
      notes,
      { channel: channel ?? '', platform: target.platform, fingerprintHash: target.fingerprintHash }
    );
    enablements.push({ ...receipt, enable });
  }
  for (const entry of enablements) {
    phase = `enablement (${entry.platform})`;
    await entry.enable();
    console.log(`Enabled OTA release with verified notes (${entry.platform}): ${entry.releaseId}`);
  }
  succeeded = true;
} catch (error) {
  recordOtaPublicationFailure(logPath, phase, error);
  console.error(
    `OTA publication failed during ${phase}. No automatic retry was attempted.${receipts.length ? ` Inspect releases ${receipts.map((receipt) => receipt.releaseId).join(', ')} before retrying.` : ' Inspect deployment state before retrying.'}`
  );
  process.exitCode = 1;
} finally {
  const completed = await finishOtaPublication(workspace, succeeded, [
    () => server.flush(),
    async () => server.database.dispose?.(),
  ]);
  if (!completed) {
    console.error(
      `Private OTA diagnostics retained at ${logPath}. Inspect the exact release before retrying.`
    );
    process.exitCode = 1;
  }
}
