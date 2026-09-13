import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createThemeStarter } from '../authoring';
import { inspectThemeImage } from '../image-inspection';
import {
  stageThemeAssetStream,
  requireThemeDiskSpace,
  type ThemeAssetChunk,
  type ThemeAssetProgress,
  type ThemeAssetStagePort,
} from '../asset-stream';
import { planThemeAssetInstall } from '../asset-storage-policy';
import { inspectGitTheme } from '../git-import';
import { createGitFixture } from './git-fixture';

const image = new Uint8Array(
  readFileSync(new URL('../../../assets/images/favicon.png', import.meta.url))
);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const owned: string[] = [];
afterEach(() => {
  for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function diskStage() {
  const directory = mkdtempSync(join(tmpdir(), 'muqun-theme-stage-test-'));
  owned.push(directory);
  let writes = 0;
  const port: ThemeAssetStagePort = {
    hash: digest,
    async writeAndDecode(name, bytes, info) {
      const path = join(directory, name);
      writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
      // Real file readback/structural validation. Native Image.loadAsync decode
      // remains a device gate and is deliberately not claimed by this adapter.
      expect(inspectThemeImage(new Uint8Array(readFileSync(path)))).toEqual(info);
      writes++;
      return path;
    },
    rollback() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
  return { directory, port, writes: () => writes };
}

function manifest(ids = ['first', 'second']) {
  const value = createThemeStarter();
  value.assets = Object.fromEntries(
    ids.map((id) => [id, { path: `assets/${id}.png`, sha256: digest(image) }])
  );
  return value;
}

async function* chunks(ids = ['first', 'second']): AsyncGenerator<ThemeAssetChunk> {
  for (const id of ids) yield { id, bytes: image };
}

test('writes each asset before requesting the next and deduplicates content-addressed files', async () => {
  const stage = diskStage();
  const progress: ThemeAssetProgress[] = [];
  async function* source() {
    yield { id: 'first', bytes: image };
    expect(stage.writes()).toBe(1);
    yield { id: 'second', bytes: image };
  }
  const result = await stageThemeAssetStream(manifest(), source(), stage.port, {
    onProgress: (value) => progress.push(value),
  });
  expect(result.first).toBe(result.second);
  expect(stage.writes()).toBe(1);
  expect(readdirSync(stage.directory)).toEqual([`${digest(image)}.png`]);
  expect(progress.at(-1)).toEqual({
    phase: 'ready',
    completedAssets: 2,
    totalAssets: 2,
    receivedBytes: image.length * 2,
  });
});

test('real isolated Git object import stages verified image bytes on disk without a ThemePackage buffer', async () => {
  const git = createGitFixture();
  const stage = diskStage();
  try {
    const data = manifest(['first']);
    const asset = git.blob(image);
    const assets = git.tree([`100644 blob ${asset}\tfirst.png`]);
    const root = git.tree([
      `040000 tree ${assets}\tassets`,
      `100644 blob ${git.blob(JSON.stringify(data))}\ttheme.json`,
    ]);
    const commit = git.commit(root);
    const inspected = await inspectGitTheme(git.objects, {
      repository: 'https://example.org/muqun/fixture',
      commit,
      manifestPath: 'theme.json',
    });
    const result = await stageThemeAssetStream(inspected.manifest, inspected.assets(), stage.port);
    expect(new Uint8Array(readFileSync(result.first))).toEqual(image);
    expect(stage.writes()).toBe(1);
  } finally {
    git.dispose();
  }
});

test('cancellation closes the producer and removes only the invocation stage', async () => {
  const stage = diskStage();
  const untouched = diskStage();
  const controller = new AbortController();
  let closed = false;
  async function* source() {
    try {
      yield { id: 'first', bytes: image };
      controller.abort(new Error('User canceled'));
      yield { id: 'second', bytes: image };
    } finally {
      closed = true;
    }
  }
  await expect(
    stageThemeAssetStream(manifest(), source(), stage.port, { signal: controller.signal })
  ).rejects.toThrow('User canceled');
  expect(closed).toBe(true);
  expect(existsSync(stage.directory)).toBe(false);
  expect(existsSync(untouched.directory)).toBe(true);
});

test('ENOSPC and decode errors propagate unchanged after rolling back owned stage', async () => {
  for (const message of ['ENOSPC: no space left on device', 'Native image decode failed']) {
    const stage = diskStage();
    const failure = new Error(message);
    const outcome = await stageThemeAssetStream(manifest(), chunks(), {
      ...stage.port,
      writeAndDecode: async () => {
        throw failure;
      },
    }).catch((error: unknown) => error);
    expect(outcome).toBe(failure);
    expect(existsSync(stage.directory)).toBe(false);
  }
});

test('unknown, duplicate, missing, corrupt and checksum-mismatched images fail closed', async () => {
  for (const ids of [['unknown'], ['first', 'first'], ['first']]) {
    const stage = diskStage();
    await expect(stageThemeAssetStream(manifest(), chunks(ids), stage.port)).rejects.toThrow(
      'match'
    );
    expect(existsSync(stage.directory)).toBe(false);
  }
  const stage = diskStage();
  const wrong = manifest(['first']);
  wrong.assets!.first.sha256 = '0'.repeat(64);
  await expect(stageThemeAssetStream(wrong, chunks(['first']), stage.port)).rejects.toThrow(
    'checksum'
  );
  const corrupt = diskStage();
  async function* bad() {
    yield { id: 'first', bytes: new Uint8Array([1, 2]) };
  }
  await expect(stageThemeAssetStream(manifest(['first']), bad(), corrupt.port)).rejects.toThrow();
});

test('streamed install planning is not capped by legacy aggregate bytes or file counts', () => {
  const inventory = Array.from({ length: 300 }, (_, index) => ({
    name: `owned-${index}`,
    bytes: 1024 * 1024,
  }));
  expect(
    planThemeAssetInstall(inventory, [{ name: 'new', bytes: 8 * 1024 * 1024 }], 'streamed')
  ).toEqual(['new']);
  expect(() => planThemeAssetInstall(inventory, [], 'legacy-package')).toThrow();
  expect(() =>
    planThemeAssetInstall(
      [{ name: 'a', bytes: Number.MAX_SAFE_INTEGER }],
      [{ name: 'b', bytes: 1 }],
      'streamed'
    )
  ).toThrow('safe integer');
});

test('actual available storage is checked while legacy in-memory expansion policy remains explicit', async () => {
  expect(() => requireThemeDiskSpace(101, 100)).toThrow('Not enough device storage');
  expect(() => requireThemeDiskSpace(100, 100)).not.toThrow();
  const stage = diskStage();
  await expect(
    stageThemeAssetStream(manifest(), chunks(), stage.port, {}, image.length)
  ).rejects.toThrow('package limit');
  const streaming = diskStage();
  expect(typeof (await stageThemeAssetStream(manifest(), chunks(), streaming.port)).second).toBe(
    'string'
  );
});

test('canceling during an in-flight decoder waits for release before removing its file', async () => {
  const stage = diskStage();
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = stageThemeAssetStream(
    manifest(['first']),
    chunks(['first']),
    {
      ...stage.port,
      async writeAndDecode(name, bytes, info) {
        const uri = await stage.port.writeAndDecode(name, bytes, info);
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return uri;
      },
    },
    { signal: controller.signal }
  );
  await started;
  controller.abort(new Error('Canceled while decoding'));
  expect(existsSync(stage.directory)).toBe(true);
  release();
  await expect(pending).rejects.toThrow('Canceled while decoding');
  expect(existsSync(stage.directory)).toBe(false);
});
