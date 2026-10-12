import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const directory = 'infrastructure/hot-updater';
const result = spawnSync(
  'bunx',
  [
    '--no-install',
    'hot-updater',
    'agent',
    'infra',
    'setup',
    '--provider',
    'cloudflare',
    '--build',
    'expo',
    '--output',
    directory,
  ],
  {
    stdio: 'inherit',
  }
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// Keep Hot Updater's runtime/templates pinned; use the operator-requested latest Wrangler CLI.
const workerPackagePath = `${directory}/worker/package.json`;
const workerPackage = JSON.parse(readFileSync(workerPackagePath, 'utf8'));
workerPackage.devDependencies.wrangler = 'latest';
writeFileSync(workerPackagePath, `${JSON.stringify(workerPackage, null, 2)}\n`);
const path = `${directory}/worker/wrangler.json`;
const config = JSON.parse(readFileSync(path, 'utf8'));
config.name = 'muqun-updates';
// Wrangler bundles the committed custom Worker rather than the upstream prebuilt bundle.
config.main = '../../ota-notes/worker.ts';
config.workers_dev = false;
config.routes = [{ pattern: 'updates.muqun.dev', custom_domain: true }];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
const serverPath = `${directory}/app/hotUpdater.ts`;
let server = readFileSync(serverPath, 'utf8');
if (!server.includes('localizedReleaseNotes')) {
  server = `import { localizedReleaseNotes } from '../../ota-notes/plugin';\n${server}`;
  server = server.replace(
    'plugins: [apiKeys(), insights(), remoteConfig()]',
    'plugins: [apiKeys(), insights(), remoteConfig(), localizedReleaseNotes()]'
  );
  if (!server.includes('remoteConfig(), localizedReleaseNotes()'))
    throw new Error('Unsupported Hot Updater server scaffold');
  writeFileSync(serverPath, server);
}
// Kept separate from upstream migrations so re-preparing cannot remove its schema.
writeFileSync(
  `${directory}/worker/migrations/0002_localized_release_notes.sql`,
  readFileSync('infrastructure/ota-notes/migration.sql')
);
console.log(
  'Prepared versioned Cloudflare templates locally. Nothing was provisioned or deployed.'
);
