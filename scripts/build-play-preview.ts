import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as nodeUtil from 'node:util';
import { readHotUpdaterAppConfig } from './hot-updater-app-config';
import { playPreviewEnvironment } from './play-preview-env';
import { summarizeBuildFailure } from './build-failure-summary';

// Available in SDK 57's required Node 22+, ahead of the repository's Node type definitions.
const { parseEnv } = nodeUtil as typeof nodeUtil & {
  parseEnv(content: string): Record<string, string>;
};
const local = existsSync('.env.hotupdater')
  ? parseEnv(readFileSync('.env.hotupdater', 'utf8'))
  : {};
const env = playPreviewEnvironment(process.env, local);
readHotUpdaterAppConfig(env, process.cwd());

const artifacts = resolve('dist/eas-builds', `play-preview-${Date.now()}`);
mkdirSync(artifacts, { recursive: true });
const privateDir = mkdtempSync(join(tmpdir(), 'muqun-play-preview-'));
const log = openSync(join(privateDir, 'build.log'), 'wx', 0o600);
let status = 1;
console.log('Building signed Play preview AAB with Hot Updater enabled; no upload or submission.');
try {
  const result = spawnSync(
    'eas',
    [
      'build',
      '--platform',
      'android',
      '--profile',
      'play-preview',
      '--local',
      '--non-interactive',
      '--freeze-credentials',
    ],
    {
      env: {
        ...env,
        EAS_LOCAL_BUILD_WORKINGDIR: join(privateDir, 'work'),
        EAS_LOCAL_BUILD_SKIP_CLEANUP: '1',
        EAS_LOCAL_BUILD_ARTIFACTS_DIR: artifacts,
      },
      // Failed EAS jobs can contain signing credentials: never forward raw logs.
      stdio: ['ignore', log, log],
    }
  );
  status = result.status ?? 1;
  if (status === 0) {
    copyFileSync(
      join(privateDir, 'work/build/fingerprint.json'),
      join(artifacts, 'fingerprint.json')
    );
    console.log(`Play preview AAB and native fingerprint: ${artifacts}`);
  } else {
    const failure = summarizeBuildFailure(readFileSync(join(privateDir, 'build.log'), 'utf8'));
    console.error(
      `EAS local build failed (exit ${status}, ${failure.phase}, ${failure.category}).`
    );
  }
} finally {
  closeSync(log);
  rmSync(privateDir, { recursive: true, force: true });
}
process.exit(status);
