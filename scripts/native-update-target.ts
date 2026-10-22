import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { nativeOtaFingerprintHash } from './publish-ota-notes';

type Platform = 'android' | 'ios';
type Channel = 'preview' | 'production' | 'ota-test';
type NativeUpdateTarget = {
  schemaVersion: 1;
  channel: Channel;
  platform: Platform;
  recordedAt: string;
  artifact: { name: string; sha256: string };
  fingerprint: unknown;
};

function targetPath(root: string, channel: string, platform: string) {
  if (!['preview', 'production', 'ota-test'].includes(channel))
    throw new Error('Invalid native update channel');
  if (!['android', 'ios'].includes(platform)) throw new Error('Invalid native update platform');
  return join(root, '.hot-updater/native-builds', channel, `${platform}.json`);
}

function atomicWrite(path: string, content: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Register only a completed native build, independently for each channel/platform. */
export function recordNativeUpdateTarget(
  root: string,
  channel: Channel,
  platform: Platform,
  artifactPath: string,
  fingerprint: unknown
) {
  const path = targetPath(root, channel, platform);
  nativeOtaFingerprintHash(fingerprint, platform);
  const artifact = readFileSync(artifactPath);
  if (!artifact.length || !artifactPath.endsWith(platform === 'android' ? '.aab' : '.ipa'))
    throw new Error('Invalid native artifact for update target');
  const target: NativeUpdateTarget = {
    schemaVersion: 1,
    channel,
    platform,
    recordedAt: new Date().toISOString(),
    artifact: {
      name: basename(artifactPath),
      sha256: createHash('sha256').update(artifact).digest('hex'),
    },
    fingerprint,
  };
  atomicWrite(path, `${JSON.stringify(target, null, 2)}\n`);
  return path;
}

export function readNativeUpdateTarget(root: string, channel: string, platform: Platform) {
  const path = targetPath(root, channel, platform);
  if (!existsSync(path))
    throw new Error(
      `No native update target for ${channel}/${platform}. Build that channel first.`
    );
  const target = JSON.parse(readFileSync(path, 'utf8')) as NativeUpdateTarget | null;
  if (
    !target ||
    target.schemaVersion !== 1 ||
    target.channel !== channel ||
    target.platform !== platform ||
    typeof target.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(target.recordedAt)) ||
    typeof target.artifact?.name !== 'string' ||
    typeof target.artifact?.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(target.artifact.sha256)
  )
    throw new Error(`Invalid native update target for ${channel}/${platform}`);
  const fingerprintHash = nativeOtaFingerprintHash(target.fingerprint, platform);
  return { ...target, fingerprintHash };
}

/** Compose only each platform's own native build, never its unbuilt sibling hash. */
export function nativeUpdateDeployment(root: string, channel: string, platform: Platform | 'both') {
  const platforms: Platform[] = platform === 'both' ? ['ios', 'android'] : [platform];
  const targets = platforms.map((selected) => readNativeUpdateTarget(root, channel, selected));
  const fingerprint: Record<string, unknown> = {};
  for (const target of targets) {
    const source = target.fingerprint as Record<string, unknown>;
    if (
      Object.hasOwn(fingerprint, 'inputs') &&
      JSON.stringify(fingerprint.inputs) !== JSON.stringify(source.inputs)
    )
      throw new Error(
        'Native fingerprint inputs differ; deploy platforms separately from their matching source state.'
      );
    fingerprint[target.platform] = source[target.platform];
    fingerprint.inputs = source.inputs;
  }
  return { targets, fingerprint };
}

/** The pinned CLI reads only the root file. Serialize its use and restore exact bytes. */
export function withNativeUpdateFingerprint<T>(
  root: string,
  fingerprint: unknown,
  run: () => T
): T {
  const lock = join(root, '.hot-updater/native-deploy.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    throw new Error('Native fingerprint is in use. Check the active deployment before retrying.');
  }
  const path = join(root, 'fingerprint.json');
  // Keep the lock if restoration fails: another deployment must not use ambiguous state.
  {
    const previous = existsSync(path) ? readFileSync(path) : null;
    if (previous) writeFileSync(join(lock, 'fingerprint.backup'), previous, { mode: 0o600 });
    try {
      atomicWrite(path, `${JSON.stringify(fingerprint, null, 2)}\n`);
      return run();
    } finally {
      if (previous) atomicWrite(path, previous);
      else rmSync(path, { force: true });
      rmSync(lock, { recursive: true });
    }
  }
}
