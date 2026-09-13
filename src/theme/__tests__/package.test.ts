import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';

import { createThemeStarter } from '@/theme/authoring';
import { packTheme, unpackTheme } from '@/theme/package';

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
