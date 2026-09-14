import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';

import { createThemeStarter } from '@/theme/authoring';
import { packTheme, unpackTheme, unpackThemeAsync } from '@/theme/package';

function files() {
  return { 'theme.json': strToU8(JSON.stringify(createThemeStarter())) };
}

test('offline colors round-trip through stored and compressed ZIP', () => {
  const manifest = createThemeStarter();
  expect(unpackTheme(packTheme({ manifest, assets: {} })).manifest).toEqual(manifest);
  expect(unpackTheme(zipSync(files(), { level: 6 })).manifest).toEqual(manifest);
});

test('declared packaged artwork round-trips byte for byte', () => {
  const manifest = createThemeStarter();
  manifest.assets = { paper: { path: 'assets/paper.png' } };
  manifest.decoration = { 'shell.background': { asset: 'paper' } };
  const bytes = new Uint8Array([1, 2, 3]);
  const output = unpackTheme(packTheme({ manifest, assets: { paper: bytes } }));
  expect(output.manifest).toEqual(manifest);
  expect(output.assets.paper).toEqual(bytes);
});

test('paths, undeclared entries and symlinks are rejected before installation', () => {
  for (const path of [
    '../theme.json',
    '/theme.json',
    'assets/../x.png',
    'assets/a.svg',
    'extra.txt',
  ]) {
    expect(() => unpackTheme(zipSync({ ...files(), [path]: new Uint8Array([1]) }))).toThrow();
  }
  expect(() => unpackTheme(zipSync({ ...files(), 'assets/a.png': new Uint8Array([1]) }))).toThrow(
    'undeclared'
  );
  const linked = zipSync({ 'theme.json': [files()['theme.json'], { os: 3, attrs: 0xa1ff0000 }] });
  expect(() => unpackTheme(linked)).toThrow('linked');
});

test('CRC corruption and truncated payloads are rejected', () => {
  const archive = zipSync(files(), { level: 0 });
  archive[45] ^= 1;
  expect(() => unpackTheme(archive)).toThrow('checksum');
  for (const length of [0, 10, archive.length - 1])
    expect(() => unpackTheme(archive.subarray(0, length))).toThrow();
});

test('unresolved remote and missing local images reject an offline package', () => {
  const manifest = createThemeStarter();
  manifest.assets = { paper: { url: 'https://example.invalid/a.png' } };
  expect(() => unpackTheme(zipSync({ 'theme.json': strToU8(JSON.stringify(manifest)) }))).toThrow(
    'contain their images'
  );
  manifest.assets = { paper: { path: 'assets/a.png' } };
  expect(() => unpackTheme(zipSync({ 'theme.json': strToU8(JSON.stringify(manifest)) }))).toThrow(
    'missing'
  );
});

test('cancellation and oversized declared output stop before extraction', () => {
  const abort = new AbortController();
  abort.abort();
  expect(() => unpackTheme(zipSync(files()), abort.signal)).toThrow();
  const archive = zipSync(files());
  const view = new DataView(archive.buffer);
  const end = archive.length - 22;
  const directory = view.getUint32(end + 16, true);
  view.setUint32(directory + 24, 0xffffffff, true);
  expect(() => unpackTheme(archive)).toThrow('expanded size limit');
});

test('dishonest DEFLATE expansion cannot exceed its output allocation', () => {
  const archive = zipSync(files());
  const view = new DataView(archive.buffer);
  const directory = view.getUint32(archive.length - 6, true);
  view.setUint32(22, 1, true);
  view.setUint32(directory + 24, 1, true);
  expect(() => unpackTheme(archive)).toThrow('actual expansion');
});

test('export requires exact own asset keys and byte arrays', () => {
  const manifest = createThemeStarter();
  manifest.assets = { constructor: { path: 'assets/paper.png' } };
  expect(() => packTheme({ manifest, assets: { other: new Uint8Array([1]) } })).toThrow(
    'asset keys'
  );
  const inherited = Object.create({ constructor: new Uint8Array([1]) });
  expect(() => packTheme({ manifest, assets: inherited })).toThrow('asset keys');
  expect(() => packTheme({ manifest, assets: { constructor: 'bytes' } as never })).toThrow(
    'asset keys'
  );
  const bytes = new Uint8Array([1]);
  const restored = unpackTheme(packTheme({ manifest, assets: { constructor: bytes } }));
  expect(Object.keys(restored.assets)).toEqual(['constructor']);
  expect(Object.values(restored.assets)[0]).toEqual(bytes);
});

test('CRC collisions cannot replace distinct assets sharing a path', () => {
  const manifest = createThemeStarter();
  manifest.assets = { first: { path: 'assets/paper.png' }, second: { path: 'assets/paper.png' } };
  // These distinct byte strings have the same CRC32; CRC is not byte identity.
  expect(() =>
    packTheme({ manifest, assets: { first: strToU8('plumless'), second: strToU8('buckeroo') } })
  ).toThrow('conflicting');
  const output = unpackTheme(
    packTheme({ manifest, assets: { first: strToU8('same'), second: strToU8('same') } })
  );
  expect(output.assets.first).toEqual(output.assets.second);
});

test('export rejects case-insensitive path collisions before producing an unusable pack', () => {
  const manifest = createThemeStarter();
  manifest.assets = { first: { path: 'assets/A.png' }, second: { path: 'assets/a.png' } };
  expect(() =>
    packTheme({ manifest, assets: { first: new Uint8Array([1]), second: new Uint8Array([1]) } })
  ).toThrow('case-insensitive');
});

/**
 * Bytes that do not compress, so an archive built from them actually exercises
 * the inflate path and is long enough to be interrupted. Deterministic, because
 * a test that pauses a different number of times per run is not a test.
 */
function noisy(length: number) {
  const bytes = new Uint8Array(length);
  let state = 0x2f6e2b1;
  for (let index = 0; index < length; index++) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

/** A two-entry archive: the manifest, and one large compressed image. */
function packaged(asset: Uint8Array) {
  const manifest = createThemeStarter();
  manifest.assets = { paper: { path: 'assets/paper.png' } };
  manifest.decoration = { 'shell.background': { asset: 'paper' } };
  return {
    manifest,
    archive: zipSync(
      { 'theme.json': strToU8(JSON.stringify(manifest)), 'assets/paper.png': asset },
      { level: 6 }
    ),
  };
}

test('the cooperative unpack produces exactly what the synchronous one does', async () => {
  const asset = noisy(700 * 1024);
  const { manifest, archive } = packaged(asset);
  const straight = unpackTheme(archive);
  const cooperative = await unpackThemeAsync(archive);
  expect(cooperative.manifest).toEqual(manifest);
  expect(cooperative.manifest).toEqual(straight.manifest);
  expect(cooperative.assets.paper).toEqual(asset);
  expect(cooperative.assets.paper).toEqual(straight.assets.paper);
  // And the stored path, which skips the inflater and goes straight to the CRC.
  const stored = packTheme({ manifest, assets: { paper: asset } });
  expect((await unpackThemeAsync(stored)).assets.paper).toEqual(asset);
});

test('the unpack hands the frame back inside an entry, not only between entries', async () => {
  const { archive } = packaged(noisy(700 * 1024));
  const progress: { completed: number; total: number }[] = [];
  let handed = 0;
  await unpackThemeAsync(archive, {
    onProgress: (value) => progress.push(value),
    yieldFrame: async () => {
      handed++;
    },
  });
  // One report before any work and one per entry: nothing is restated,
  // `completed` only ever goes up, and `total` never moves under it.
  expect(progress).toEqual([
    { completed: 0, total: 2 },
    { completed: 1, total: 2 },
    { completed: 2, total: 2 },
  ]);
  // More pauses than reports is the whole point. A report per entry alone
  // would leave the inflate and the CRC of one large image uninterrupted,
  // which is exactly the block that used to hold the frame.
  expect(handed).toBeGreaterThan(progress.length);
});

test('the cooperative unpack rejects everything the synchronous one rejects', async () => {
  const corrupt = zipSync(files(), { level: 0 });
  corrupt[45] ^= 1;
  await expect(unpackThemeAsync(corrupt)).rejects.toThrow('checksum');
  await expect(unpackThemeAsync(corrupt.subarray(0, 10))).rejects.toThrow();
  await expect(
    unpackThemeAsync(zipSync({ ...files(), '../theme.json': new Uint8Array([1]) }))
  ).rejects.toThrow();
  await expect(
    unpackThemeAsync(zipSync({ ...files(), 'assets/a.png': new Uint8Array([1]) }))
  ).rejects.toThrow('undeclared');
  const aborted = new AbortController();
  aborted.abort();
  await expect(unpackThemeAsync(zipSync(files()), { signal: aborted.signal })).rejects.toThrow();
});

test('cancellation raised while the unpack is paused stops it mid-entry', async () => {
  const { archive } = packaged(noisy(700 * 1024));
  const controller = new AbortController();
  let handed = 0;
  let reports = 0;
  await expect(
    unpackThemeAsync(archive, {
      onProgress: () => reports++,
      yieldFrame: async () => {
        // The fourth pause is inside the large entry: the first is the opening
        // report, the second follows the manifest entry, and everything after
        // that is the image's own inflate and CRC blocks.
        if (++handed === 4) controller.abort(new Error('Canceled by user'));
      },
      signal: controller.signal,
    })
  ).rejects.toThrow('Canceled by user');
  expect(handed).toBe(4);
  // Stopped before the second entry could be reported as done.
  expect(reports).toBe(2);
});
