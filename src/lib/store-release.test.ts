import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  parseStoreCommand,
  runStoreCommand,
  selectStoreArtifact,
  storeProfile,
} from '../../scripts/store-release';
import eas from '../../eas.json';

const directories: string[] = [];
const output: unknown[][] = [];
const errors: unknown[][] = [];
const originalLog = console.log;
const originalError = console.error;
beforeEach(() => {
  console.log = (...args: unknown[]) => {
    output.push(args);
  };
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
});
afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  output.length = 0;
  errors.length = 0;
});

function fixture(buildStatus = 0, artifactCount = 1, submitStatus = 0) {
  const root = mkdtempSync(join(tmpdir(), 'muqun-store-script-test-'));
  directories.push(root);
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'keys'));
  copyFileSync(resolve('keys/hot-updater-public.pem'), join(root, 'keys/hot-updater-public.pem'));
  writeFileSync(
    join(root, '.env.hotupdater'),
    'EXPO_PUBLIC_HOT_UPDATER_API_KEY=public-client\nHOT_UPDATER_CLOUDFLARE_API_TOKEN=provider-secret\n'
  );
  writeFileSync(
    join(root, 'bin/eas'),
    `#!/bin/sh
printf '%s\\n' "$*" >> calls
printf '%s\\n' "$HOT_UPDATER_CHANNEL:$EXPO_PUBLIC_HOT_UPDATER_ENABLED:$HOT_UPDATER_CLOUDFLARE_API_TOKEN" >> environment
if [ "$1" = build ]; then
  printf '%s' "$EAS_LOCAL_BUILD_WORKINGDIR" > private-work
  printf '%s\\n' 'PRIVATE_SIGNING_PAYLOAD_DO_NOT_PRINT'
  if [ '${buildStatus}' != 0 ]; then exit '${buildStatus}'; fi
  /bin/mkdir -p "$EAS_LOCAL_BUILD_WORKINGDIR/build"
  printf '{}' > "$EAS_LOCAL_BUILD_WORKINGDIR/build/fingerprint.json"
  extension=aab
  if [ "$3" = ios ]; then extension=ipa; fi
  if [ '${artifactCount}' != 0 ]; then printf artifact > "$EAS_LOCAL_BUILD_ARTIFACTS_DIR/new.$extension"; fi
  if [ '${artifactCount}' = 2 ]; then printf artifact > "$EAS_LOCAL_BUILD_ARTIFACTS_DIR/second.$extension"; fi
fi
if [ "$1" = submit ]; then
  printf '%s\\n' 'PRIVATE_SUBMISSION_PAYLOAD_DO_NOT_PRINT'
  exit '${submitStatus}'
fi
`,
    { mode: 0o700 }
  );
  return {
    root,
    env: {
      PATH: join(root, 'bin'),
      HOT_UPDATER_CHANNEL: 'wrong',
      HOT_UPDATER_CLOUDFLARE_API_TOKEN: 'inherited-secret',
    },
  };
}

test('preview and production plans preserve store identity and test destinations', () => {
  expect(storeProfile('android', 'preview')).toBe('play-preview');
  expect(storeProfile('ios', 'preview')).toBe('testflight');
  expect(storeProfile('android', 'production')).toBe('production');
  expect(storeProfile('ios', 'production')).toBe('production');
  expect(eas.submit['play-preview'].android).toEqual(eas.submit.production.android);
  expect(eas.submit.production.android).toEqual({ track: 'internal', releaseStatus: 'completed' });
  expect(eas.submit.testflight.ios).toEqual(eas.submit.production.ios);
  expect(eas.build.testflight.env.HOT_UPDATER_CHANNEL).toBe('preview');
  expect(eas.build.production.env.HOT_UPDATER_CHANNEL).toBe('production');
});

test('CLI rejects missing/ambiguous inputs instead of falling back to latest', () => {
  for (const args of [
    [],
    ['submit', 'android', 'preview'],
    ['submit', 'ios', 'production', '--latest'],
    ['build', 'android', 'preview', '--path', 'old.aab'],
    ['submit', 'android', 'preview', '--path', '--latest'],
  ]) {
    expect(() => parseStoreCommand(args)).toThrow('Usage:');
  }
  expect(parseStoreCommand(['submit', 'ios', 'preview', '--path', 'exact.ipa'])).toEqual({
    action: 'submit',
    platform: 'ios',
    channel: 'preview',
    path: 'exact.ipa',
  });
});

test('release submits only the new isolated artifact, preserves fingerprint, and deletes private logs', () => {
  const { root, env } = fixture();
  mkdirSync(join(root, 'dist/eas-builds'), { recursive: true });
  writeFileSync(join(root, 'dist/eas-builds/newer-looking-old.aab'), 'stale');
  expect(
    runStoreCommand({ action: 'release', platform: 'android', channel: 'preview' }, root, env)
  ).toBe(0);
  const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain('--freeze-credentials');
  const folder = readdirSync(join(root, 'dist/eas-builds')).find((name) =>
    name.startsWith('android-preview-')
  );
  const artifact = join(root, 'dist/eas-builds', folder ?? '', 'new.aab');
  expect(calls[1]).toBe(
    `submit --platform android --profile play-preview --path ${artifact} --non-interactive --wait`
  );
  expect(existsSync(join(root, 'dist/eas-builds', folder ?? '', 'fingerprint.json'))).toBe(true);
  expect(existsSync(readFileSync(join(root, 'private-work'), 'utf8'))).toBe(false);
  expect(readFileSync(join(root, 'environment'), 'utf8')).toBe('preview:1:\npreview:1:\n');
  expect(JSON.stringify([...output, ...errors])).not.toContain('PRIVATE_SIGNING_PAYLOAD');
});

test('failed build neither submits nor leaves private job logs', () => {
  const { root, env } = fixture(17);
  expect(
    runStoreCommand({ action: 'release', platform: 'android', channel: 'production' }, root, env)
  ).toBe(17);
  expect(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n')).toHaveLength(1);
  expect(existsSync(readFileSync(join(root, 'private-work'), 'utf8'))).toBe(false);
  expect(JSON.stringify(errors)).not.toContain('PRIVATE_SIGNING_PAYLOAD');
});

test('missing and duplicate outputs stop release without using an older artifact', () => {
  for (const count of [0, 2]) {
    const { root, env } = fixture(0, count);
    expect(() =>
      runStoreCommand({ action: 'release', platform: 'android', channel: 'preview' }, root, env)
    ).toThrow('exactly one');
    expect(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(readFileSync(join(root, 'private-work'), 'utf8'))).toBe(false);
  }
});

test('build-only never uploads and production selects the production channel', () => {
  const { root, env } = fixture();
  expect(
    runStoreCommand({ action: 'build', platform: 'android', channel: 'production' }, root, env)
  ).toBe(0);
  expect(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n')).toHaveLength(1);
  expect(readFileSync(join(root, 'environment'), 'utf8')).toBe('production:1:\n');
});

test('iOS local builds fail before touching credentials, files, or EAS on Linux', () => {
  const { root, env } = fixture();
  expect(() =>
    runStoreCommand({ action: 'release', platform: 'ios', channel: 'preview' }, root, env, 'linux')
  ).toThrow('require macOS');
  expect(existsSync(join(root, 'calls'))).toBe(false);
  expect(existsSync(join(root, 'dist'))).toBe(false);
});

test('explicit iOS submission uses only the requested IPA without reading build credentials', () => {
  const { root, env } = fixture();
  rmSync(join(root, '.env.hotupdater'));
  const artifact = join(root, 'selected.ipa');
  writeFileSync(artifact, 'verified-ipa');
  expect(
    runStoreCommand(
      { action: 'submit', platform: 'ios', channel: 'preview', path: artifact },
      root,
      env,
      'linux'
    )
  ).toBe(0);
  expect(readFileSync(join(root, 'calls'), 'utf8').trim()).toBe(
    `submit --platform ios --profile testflight --path ${artifact} --non-interactive --wait`
  );
});

test('explicit missing/empty/wrong-platform files and symlink artifacts never reach EAS', () => {
  const { root, env } = fixture();
  writeFileSync(join(root, 'empty.aab'), '');
  writeFileSync(join(root, 'wrong.ipa'), 'artifact');
  symlinkSync(join(root, 'wrong.ipa'), join(root, 'alias.aab'));
  for (const path of ['missing.aab', 'empty.aab', 'wrong.ipa', 'alias.aab']) {
    expect(() =>
      runStoreCommand(
        { action: 'submit', platform: 'android', channel: 'preview', path },
        root,
        env
      )
    ).toThrow('existing, nonempty');
  }
  expect(existsSync(join(root, 'calls'))).toBe(false);
  expect(() => selectStoreArtifact(root, 'android')).toThrow('exactly one');
});

test('failed submission retains the artifact and never rebuilds or retries', () => {
  const { root, env } = fixture(0, 1, 23);
  expect(
    runStoreCommand({ action: 'release', platform: 'android', channel: 'preview' }, root, env)
  ).toBe(23);
  expect(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n')).toHaveLength(2);
  expect(existsSync(readFileSync(join(root, 'private-work'), 'utf8'))).toBe(false);
  const folder = readdirSync(join(root, 'dist/eas-builds'))[0];
  expect(existsSync(join(root, 'dist/eas-builds', folder, 'new.aab'))).toBe(true);
  expect(JSON.stringify([...output, ...errors])).not.toContain('PRIVATE_SUBMISSION_PAYLOAD');
});

test('mocked macOS release builds and submits the same iOS preview IPA', () => {
  const { root, env } = fixture();
  expect(
    runStoreCommand({ action: 'release', platform: 'ios', channel: 'preview' }, root, env, 'darwin')
  ).toBe(0);
  const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
  expect(calls[0]).toBe(
    'build --platform ios --profile testflight --local --non-interactive --freeze-credentials'
  );
  const folder = readdirSync(join(root, 'dist/eas-builds'))[0];
  expect(calls[1]).toBe(
    `submit --platform ios --profile testflight --path ${join(root, 'dist/eas-builds', folder, 'new.ipa')} --non-interactive --wait`
  );
  expect(existsSync(readFileSync(join(root, 'private-work'), 'utf8'))).toBe(false);
});
