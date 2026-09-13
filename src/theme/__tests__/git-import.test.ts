import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createThemeStarter } from '../authoring';
import { gitThemePath, gitThemeSource, inspectGitTheme } from '../git-import';
import { packTheme, unpackTheme, type ThemePackage } from '../package';
import { parseThemeManifest, THEME_LIMITS } from '../schema';
import { createGitFixture } from './git-fixture';

const fixture = createGitFixture();
afterAll(() => fixture.dispose());
const source = (commit: string, manifestPath = 'theme.json') => ({
  repository: 'https://example.org/muqun/theme',
  commit,
  manifestPath,
});
const manifest = createThemeStarter();
const image = new Uint8Array(
  readFileSync(new URL('../../../assets/images/favicon.png', import.meta.url))
);
manifest.assets = {
  logo: { path: 'assets/logo.png', sha256: createHash('sha256').update(image).digest('hex') },
};
manifest.decoration = { 'shell.background': { asset: 'logo' } };
const imageOid = fixture.blob(image);
const manifestOid = fixture.blob(JSON.stringify(manifest));
const assetTree = fixture.tree([`100644 blob ${imageOid}\tlogo.png`]);
const rootTree = fixture.tree([
  `040000 tree ${assetTree}\tassets`,
  `100644 blob ${manifestOid}\ttheme.json`,
]);
const commit = fixture.commit(rootTree);

test('real pinned Git objects import through the existing ThemePackage and manifest validators', async () => {
  const inspected = await inspectGitTheme(fixture.objects, source(commit));
  const theme: ThemePackage = { manifest: inspected.manifest, assets: {} };
  for await (const asset of inspected.assets()) theme.assets[asset.id] = asset.bytes;
  expect(theme.assets.logo).toEqual(image);
  const roundtrip = unpackTheme(packTheme(theme));
  expect(parseThemeManifest(JSON.stringify(roundtrip.manifest))).toEqual(manifest);
  expect(roundtrip.assets.logo).toEqual(image);
});

test('moving a branch cannot change an import pinned to its commit', async () => {
  fixture.git(['update-ref', 'refs/heads/theme-fixture', commit]);
  const replacement = createThemeStarter();
  replacement.name = 'Different revision';
  const next = fixture.commit(
    fixture.tree([`100644 blob ${fixture.blob(JSON.stringify(replacement))}\ttheme.json`])
  );
  fixture.git(['update-ref', 'refs/heads/theme-fixture', next]);
  expect((await inspectGitTheme(fixture.objects, source(commit))).manifest.name).toBe(
    manifest.name
  );
});

test('selected symlinks, executable files, gitlinks and linked ancestors are rejected', async () => {
  for (const mode of ['120000', '100755']) {
    const bad = fixture.commit(fixture.tree([`${mode} blob ${manifestOid}\ttheme.json`]));
    await expect(inspectGitTheme(fixture.objects, source(bad))).rejects.toThrow('links');
  }
  const submodule = fixture.commit(fixture.tree([`160000 commit ${commit}\ttheme.json`]));
  await expect(inspectGitTheme(fixture.objects, source(submodule))).rejects.toThrow('submodules');
  const linkedParent = fixture.commit(fixture.tree([`120000 blob ${manifestOid}\tthemes`]));
  await expect(
    inspectGitTheme(fixture.objects, source(linkedParent, 'themes/theme.json'))
  ).rejects.toThrow('links');
  const linkedAssets = fixture.tree([`120000 blob ${imageOid}\tlogo.png`]);
  const linkedImage = fixture.commit(
    fixture.tree([`040000 tree ${linkedAssets}\tassets`, `100644 blob ${manifestOid}\ttheme.json`])
  );
  const inspected = await inspectGitTheme(fixture.objects, source(linkedImage));
  await expect(inspected.assets().next()).rejects.toThrow('links');
});

test('rejects unsafe paths, mutable revisions and local or executable Git protocols', () => {
  for (const path of [
    '../theme.json',
    '/theme.json',
    'a//theme.json',
    '.git/config',
    'a\\b',
    'a/./theme.json',
    'a/'.repeat(13) + 'theme.json',
  ])
    expect(() => gitThemePath(path)).toThrow();
  for (const repository of [
    'file:///tmp/theme',
    'ssh://example.org/theme',
    'git://example.org/theme',
    'https://127.0.0.1/theme',
    'https://example.org/theme?x=1',
  ])
    expect(() => gitThemeSource({ ...source(commit), repository })).toThrow();
  for (const revision of ['main', 'HEAD', commit.slice(0, 12), `${commit}:theme.json`])
    expect(() => gitThemeSource(source(revision))).toThrow('full commit');
});

test('rejects oversized manifest blobs before reading or decoding their contents', async () => {
  const large = fixture.blob(' '.repeat(THEME_LIMITS.manifestBytes + 1));
  const bad = fixture.commit(fixture.tree([`100644 blob ${large}\ttheme.json`]));
  await expect(inspectGitTheme(fixture.objects, source(bad))).rejects.toThrow('oversized');
});

test('rejects object substitution and honors cancellation before reading', async () => {
  await expect(
    inspectGitTheme({ ...fixture.objects, digest: async () => '0'.repeat(40) }, source(commit))
  ).rejects.toThrow('identity');
  const controller = new AbortController();
  controller.abort(new Error('Canceled fixture'));
  await expect(inspectGitTheme(fixture.objects, source(commit), controller.signal)).rejects.toThrow(
    'Canceled'
  );
});

test('never downloads LFS pointers or remote URL assets', async () => {
  const pointer = fixture.blob(
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 100\n'
  );
  const assets = fixture.tree([`100644 blob ${pointer}\tlogo.png`]);
  const bad = fixture.commit(
    fixture.tree([`040000 tree ${assets}\tassets`, `100644 blob ${manifestOid}\ttheme.json`])
  );
  const inspected = await inspectGitTheme(fixture.objects, source(bad));
  await expect(inspected.assets().next()).rejects.toThrow('LFS');
  const remote = { ...manifest, assets: { logo: { url: 'https://example.org/logo.png' } } };
  const external = fixture.commit(
    fixture.tree([`100644 blob ${fixture.blob(JSON.stringify(remote))}\ttheme.json`])
  );
  await expect(inspectGitTheme(fixture.objects, source(external))).rejects.toThrow('pinned commit');
});

test('bounds tree entry metadata independently of total theme size', async () => {
  const entries = Array.from(
    { length: 4097 },
    (_, index) => `100644 blob ${manifestOid}\tfile-${index}`
  );
  entries.push(`100644 blob ${manifestOid}\ttheme.json`);
  const crowded = fixture.commit(fixture.tree(entries));
  await expect(inspectGitTheme(fixture.objects, source(crowded))).rejects.toThrow(
    'too many entries'
  );
});

test('asset iteration inherits cancellation and checks declared SHA-256', async () => {
  const controller = new AbortController();
  const inspected = await inspectGitTheme(fixture.objects, source(commit), controller.signal);
  controller.abort(new Error('Canceled asset staging'));
  await expect(inspected.assets().next()).rejects.toThrow('Canceled asset');
  const wrong = {
    ...manifest,
    assets: { logo: { path: 'assets/logo.png', sha256: '0'.repeat(64) } },
  };
  const bad = fixture.commit(
    fixture.tree([
      `040000 tree ${assetTree}\tassets`,
      `100644 blob ${fixture.blob(JSON.stringify(wrong))}\ttheme.json`,
    ])
  );
  const candidate = await inspectGitTheme(fixture.objects, source(bad));
  await expect(candidate.assets().next()).rejects.toThrow('checksum');
});
