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
const path = `${directory}/worker/wrangler.json`;
const config = JSON.parse(readFileSync(path, 'utf8'));
config.name = 'muqun-updates';
config.workers_dev = false;
config.routes = [{ pattern: 'updates.muqun.dev', custom_domain: true }];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  'Prepared versioned Cloudflare templates locally. Nothing was provisioned or deployed.'
);
