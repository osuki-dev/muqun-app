import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeUtil from 'node:util';
import { readHotUpdaterAppConfig } from './hot-updater-app-config';
import { storeReleaseEnvironment, type StoreChannel } from './store-release-env';
import { summarizeBuildFailure } from './build-failure-summary';

class StoreCommandError extends Error {}

type StorePlatform = 'android' | 'ios';
type StoreCommand = {
  action: 'build' | 'release' | 'submit';
  platform: StorePlatform;
  channel: StoreChannel;
  path?: string;
};

export function parseStoreCommand(args: string[]): StoreCommand {
  const [action, platform, channel, ...rest] = args;
  if (
    (action !== 'build' && action !== 'release' && action !== 'submit') ||
    (platform !== 'android' && platform !== 'ios') ||
    (channel !== 'preview' && channel !== 'production') ||
    (action === 'submit'
      ? rest.length !== 2 || rest[0] !== '--path' || !rest[1] || rest[1].startsWith('--')
      : rest.length !== 0)
  ) {
    throw new StoreCommandError(
      'Usage: store-release.ts <build|release|submit> <android|ios> <preview|production> [--path exact-artifact]'
    );
  }
  return { action, platform, channel, path: rest[1] };
}

export function storeProfile(platform: StorePlatform, channel: StoreChannel) {
  return channel === 'production'
    ? 'production'
    : platform === 'android'
      ? 'play-preview'
      : 'testflight';
}

function validateArtifact(path: string, platform: StorePlatform) {
  const extension = platform === 'android' ? '.aab' : '.ipa';
  if (
    !path.endsWith(extension) ||
    !existsSync(path) ||
    !lstatSync(path).isFile() ||
    lstatSync(path).size === 0
  ) {
    throw new StoreCommandError(
      `Expected one existing, nonempty ${extension} file; no build or submission started.`
    );
  }
  return path;
}

export function selectStoreArtifact(directory: string, platform: StorePlatform) {
  const extension = platform === 'android' ? '.aab' : '.ipa';
  const artifacts = readdirSync(directory).filter((name) => name.endsWith(extension));
  if (artifacts.length !== 1)
    throw new StoreCommandError(`Build must produce exactly one ${extension}; submission stopped.`);
  return validateArtifact(join(directory, artifacts[0]), platform);
}

/** One invocation owns its artifact directory and private logs. Never select a previous build. */
export function runStoreCommand(
  command: StoreCommand,
  projectRoot = process.cwd(),
  inherited: Readonly<Record<string, string | undefined>> = process.env,
  hostPlatform: string = process.platform
) {
  if (command.action !== 'submit' && command.platform === 'ios' && hostPlatform !== 'darwin') {
    throw new StoreCommandError(
      'Local iOS builds require macOS with Xcode. No build or submission started.'
    );
  }
  let artifact =
    command.action === 'submit'
      ? validateArtifact(resolve(projectRoot, command.path ?? ''), command.platform)
      : undefined;
  // Available in SDK 57's required Node 22+, ahead of this repository's Node types.
  const { parseEnv } = nodeUtil as typeof nodeUtil & {
    parseEnv(content: string): Record<string, string>;
  };
  const envFile = join(projectRoot, '.env.hotupdater');
  // EAS Submit also evaluates app.config; only allowlisted public settings leave this file.
  const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const env = storeReleaseEnvironment(inherited, local, command.channel);
  if (command.action !== 'submit') readHotUpdaterAppConfig(env, projectRoot);
  const profile = storeProfile(command.platform, command.channel);
  const androidBuild = command.action !== 'submit' && command.platform === 'android';
  const temporaryRoot = androidBuild ? resolve(projectRoot, 'dist/cache') : tmpdir();
  mkdirSync(temporaryRoot, { recursive: true });
  const privateDir = mkdtempSync(join(temporaryRoot, 'muqun-store-release-'));
  const logPath = join(privateDir, 'eas.log');
  const log = openSync(logPath, 'wx', 0o600);
  try {
    if (command.action !== 'submit') {
      const buildEnv = {
        ...env,
        TMPDIR: env.TMPDIR,
        _JAVA_OPTIONS: env._JAVA_OPTIONS || '-Xmx6g -XX:MaxMetaspaceSize=2g',
      };
      if (androidBuild) {
        const javaTemporaryDir = join(privateDir, 'tmp');
        mkdirSync(javaTemporaryDir);
        buildEnv.TMPDIR = javaTemporaryDir;
        // Java ignores TMPDIR. Append overrides without discarding caller JVM options;
        // avoid reusing a Gradle daemon whose temporary directory belongs to an older run.
        buildEnv._JAVA_OPTIONS += ` -Djava.io.tmpdir="${javaTemporaryDir}" -Dorg.gradle.daemon=false`;
      }
      const artifactsRoot = join(projectRoot, 'dist/eas-builds');
      mkdirSync(artifactsRoot, { recursive: true });
      const artifacts = mkdtempSync(join(artifactsRoot, `${command.platform}-${command.channel}-`));
      console.log(`Building ${command.platform} with Hot Updater channel ${command.channel}.`);
      const result = spawnSync(
        'eas',
        [
          'build',
          '--platform',
          command.platform,
          '--profile',
          profile,
          '--local',
          '--non-interactive',
          '--freeze-credentials',
        ],
        {
          cwd: projectRoot,
          env: {
            ...buildEnv,
            EAS_LOCAL_BUILD_WORKINGDIR: join(privateDir, 'work'),
            EAS_LOCAL_BUILD_SKIP_CLEANUP: '1',
            EAS_LOCAL_BUILD_ARTIFACTS_DIR: artifacts,
          },
          // Failed EAS jobs may contain signing credentials. Never forward raw output.
          stdio: ['ignore', log, log],
        }
      );
      if (result.error || result.status !== 0) {
        const failure = summarizeBuildFailure(readFileSync(logPath, 'utf8'));
        console.error(
          `EAS build failed (${failure.phase}, ${failure.category}); nothing submitted.`
        );
        return result.status || 1;
      }
      artifact = selectStoreArtifact(artifacts, command.platform);
      const fingerprint = join(privateDir, 'work/build/fingerprint.json');
      if (!existsSync(fingerprint))
        throw new StoreCommandError('Native fingerprint missing; submission stopped.');
      copyFileSync(fingerprint, join(artifacts, 'fingerprint.json'));
      console.log(
        `Artifact: ${artifact}\nNative fingerprint: ${join(artifacts, 'fingerprint.json')}`
      );
    }
    if (command.action === 'build') return 0;
    if (!artifact) throw new StoreCommandError('Missing artifact; submission stopped.');
    console.log(
      `Submitting ${artifact} to ${command.platform === 'android' ? 'Play internal testing' : 'TestFlight'}.`
    );
    const result = spawnSync(
      'eas',
      [
        'submit',
        '--platform',
        command.platform,
        '--profile',
        profile,
        '--path',
        artifact,
        '--non-interactive',
        '--wait',
      ],
      { cwd: projectRoot, env, stdio: ['ignore', log, log] }
    );
    // Only Expo's canonical submission URL may leave the private log.
    const urls = readFileSync(logPath, 'utf8').match(
      /https:\/\/expo\.dev\/accounts\/[\w-]+\/projects\/[\w-]+\/submissions\/[\da-f-]+/g
    );
    if (urls) for (const url of new Set(urls)) console.log(url);
    if (result.error || result.status !== 0) {
      console.error(
        'EAS submission did not finish successfully. Check its status in Expo before retrying; the artifact is retained.'
      );
      return result.status || 1;
    }
    console.log('EAS submission completed. Store processing may delay availability to testers.');
    return 0;
  } finally {
    closeSync(log);
    rmSync(privateDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runStoreCommand(parseStoreCommand(process.argv.slice(2)));
  } catch (error) {
    // Only our fixed validation messages are safe; filesystem/child errors may contain secrets.
    console.error(
      error instanceof StoreCommandError
        ? error.message
        : 'Store command failed; no raw EAS logs were retained.'
    );
    process.exitCode = 1;
  }
}
