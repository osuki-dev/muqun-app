import { expect, test } from 'bun:test';
import { ThemeRepository, effectiveThemeAssets, effectiveThemeManifest } from '../repository';
import { createThemeStarter } from '../starter';
import { createThemeAssetPaths } from '../asset-paths';
import { ThemeAssetLifecycle } from '../asset-lifecycle';
import { themeAssetReferences } from '../artwork-overrides';
import { commitThemeArtworkSelection } from '../artwork-selection';
import { resolveThemeImage } from '../resolve';
import { planUnusedThemes } from '@/lib/theme-storage';
import { exportThemePackage } from '../export-package';
import { unpackTheme } from '../package';
import { resolveCandidateTheme } from '../candidate-theme';
import { resolveLaunchArtwork } from '../launch-artwork';

const directory = 'file:///app/Documents/theme-assets-v1';
const image = (letter: string) => `${directory}/${letter.repeat(64)}.png`;
const author = image('a');
const shared = image('b');
const replacement = image('c');

function harness() {
  let stored: string | undefined;
  let failWrite = false;
  let sequence = 0;
  const files = new Set([author, shared, replacement]);
  const lifecycle = new ThemeAssetLifecycle();
  const storage = {
    read: () => stored,
    write: (value: string) => {
      if (failWrite) throw new Error('storage unavailable');
      stored = value;
    },
  };
  const repository = new ThemeRepository(
    storage,
    () => `theme-${++sequence}`,
    (uri) => files.has(uri),
    createThemeAssetPaths(directory)
  );
  repository.hydrate();
  const publish = () => {
    lifecycle.replaceReferences(repository.snapshot().themes.flatMap(themeAssetReferences));
    for (const uri of files) if (lifecycle.canCollect(uri)) files.delete(uri);
  };
  const install = (id: string) => {
    const manifest = createThemeStarter();
    manifest.id = id;
    manifest.assets = { authored: { path: 'assets/authored.png' } };
    manifest.decoration = { 'home.artwork': { asset: 'authored', fit: 'cover' } };
    return repository.save(JSON.stringify(manifest), { authored: author });
  };
  return {
    repository,
    storage,
    files,
    lifecycle,
    publish,
    install,
    stored: () => stored,
    fail: () => {
      failWrite = true;
    },
  };
}

test('personal artwork is theme-scoped, survives reload and re-import, and resets to authored variants', () => {
  const run = harness();
  const first = run.install('first');
  const second = run.install('second');
  run.repository.setHomeArtwork(first.id, 'hidden');
  run.repository.setArtworkImage(first.id, 'home.artwork', shared);
  run.repository.setArtworkImage(first.id, 'launch.artwork', replacement);
  run.repository.apply({ kind: 'custom', id: second.id });
  expect(run.repository.activeInstalled()?.artworkImages).toBeUndefined();
  run.repository.apply({ kind: 'custom', id: first.id });
  expect(run.repository.activeInstalled()?.homeArtwork).toBe('shown');
  const restored = new ThemeRepository(
    run.storage,
    () => 'new',
    (uri) => run.files.has(uri),
    createThemeAssetPaths(directory)
  );
  restored.hydrate();
  const installed = restored.activeInstalled()!;
  const effective = effectiveThemeManifest(installed);
  expect(
    effectiveThemeAssets(installed)[
      resolveThemeImage(effective, 'home.artwork', 'dark', 'regular')!.asset
    ]
  ).toBe(shared);
  expect(
    effectiveThemeAssets(installed)[
      resolveThemeImage(effective, 'launch.artwork', 'light', 'compact')!.asset
    ]
  ).toBe(replacement);
  expect(installed.manifest.decoration?.['home.artwork']?.asset).toBe('authored');
  const nextManifest = { ...installed.manifest, version: '2.0.0' };
  expect(restored.save(JSON.stringify(nextManifest), installed.assets).artworkImages).toEqual(
    installed.artworkImages
  );
  restored.setArtworkImage(first.id, 'home.artwork', undefined);
  expect(restored.activeInstalled()?.homeArtwork).toBeUndefined();
  expect(restored.activeInstalled()?.artworkImages).toEqual({ 'launch.artwork': replacement });
  restored.resetAppearancePreferences(first.id);
  const reset = restored.activeInstalled()!;
  expect(reset.artworkImages).toBeUndefined();
  expect(
    resolveThemeImage(effectiveThemeManifest(reset), 'home.artwork', 'dark', 'regular')?.asset
  ).toBe('authored');
});

test('mode and responsive authored images cannot shadow a chosen picture; author ids remain distinct', () => {
  const run = harness();
  const manifest = createThemeStarter();
  manifest.assets = { 'personal-home-artwork': { path: 'assets/original.png' } };
  manifest.decoration = { 'home.artwork': { asset: 'personal-home-artwork', regular: null } };
  manifest.variantDecorations = { dark: { 'home.artwork': null } };
  manifest.homeIdentity = { artwork: { mode: 'hidden' } };
  const installed = run.repository.save(JSON.stringify(manifest), {
    'personal-home-artwork': author,
  });
  run.repository.setArtworkImage(installed.id, 'home.artwork', shared);
  const saved = run.repository.snapshot().themes[0];
  const effective = effectiveThemeManifest(saved);
  for (const mode of ['light', 'dark'] as const)
    for (const width of ['compact', 'regular'] as const) {
      const resolved = resolveThemeImage(effective, 'home.artwork', mode, width)!;
      expect(resolved.asset).not.toBe('personal-home-artwork');
      expect(effectiveThemeAssets(saved)[resolved.asset]).toBe(shared);
    }
  expect(effective.homeIdentity?.artwork?.mode).toBe('default');
  expect(saved.manifest).toEqual(manifest);
});

test('deleting, replacing and resetting personal images retain every other durable reference', () => {
  const run = harness();
  const first = run.install('first');
  const second = run.install('second');
  run.repository.setArtworkImage(first.id, 'home.artwork', shared);
  run.repository.setArtworkImage(second.id, 'launch.artwork', shared);
  const releaseReplacement = run.lifecycle.reserve([replacement]);
  run.publish();
  run.repository.setArtworkImage(first.id, 'home.artwork', replacement);
  run.publish();
  releaseReplacement();
  run.publish();
  expect(run.files.has(shared)).toBe(true);
  expect(run.files.has(replacement)).toBe(true);
  run.repository.resetAppearancePreferences(first.id);
  run.publish();
  expect(run.files.has(replacement)).toBe(false);
  expect(run.files.has(shared)).toBe(true);
  const unused = planUnusedThemes(
    run.repository.snapshot().themes,
    { kind: 'custom', id: first.id },
    [
      { name: shared.split('/').at(-1)!, uri: shared, bytes: 42 },
      { name: author.split('/').at(-1)!, uri: author, bytes: 100 },
    ]
  );
  expect(unused.reclaimableBytes).toBe(42);
  run.repository.remove(second.id);
  run.publish();
  expect(run.files.has(shared)).toBe(false);
  expect(run.files.has(author)).toBe(true);
  expect(JSON.parse(run.stored()!).themes).toHaveLength(1);
});

test('failed persistence leaves both ownership and previous artwork intact', async () => {
  const run = harness();
  const theme = run.install('first');
  run.repository.setArtworkImage(theme.id, 'home.artwork', shared);
  const before = run.stored();
  const release = run.lifecycle.reserve([replacement]);
  run.publish();
  run.fail();
  await expect(
    commitThemeArtworkSelection({
      pick: async () => ({
        uri: replacement,
        dispose: () => {
          release();
          run.publish();
        },
      }),
      isCurrent: () => true,
      commit: (picked) => {
        run.repository.setArtworkImage(theme.id, 'home.artwork', picked.uri);
        return false;
      },
    })
  ).rejects.toThrow('storage unavailable');
  expect(run.stored()).toBe(before);
  expect(run.repository.snapshot().themes[0].artworkImages?.['home.artwork']).toBe(shared);
  expect(run.files.has(shared)).toBe(true);
  expect(run.files.has(replacement)).toBe(false);
});

test('late picker answers cannot write another theme, revive deletion, or retain canceled copies', async () => {
  for (const reason of ['changed-theme', 'closed', 'canceled', 'deleted']) {
    const run = harness();
    const theme = run.install('first');
    const release = run.lifecycle.reserve([shared]);
    let current = true;
    let answer!: (value: { uri: string; dispose: () => void } | null) => void;
    const pending = commitThemeArtworkSelection({
      pick: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      isCurrent: () => current,
      commit: (picked) => {
        run.repository.setArtworkImage(theme.id, 'home.artwork', picked.uri);
        run.publish();
        return false;
      },
    });
    if (reason === 'deleted') run.repository.remove(theme.id);
    else current = false;
    if (reason === 'canceled') {
      release();
      answer(null);
    } else
      answer({
        uri: shared,
        dispose: () => {
          release();
          run.publish();
        },
      });
    if (reason === 'deleted') await expect(pending).rejects.toThrow('no longer installed');
    else await pending;
    run.publish();
    expect(run.files.has(shared)).toBe(false);
    expect(
      run.repository.snapshot().themes.every((entry) => entry.artworkImages === undefined)
    ).toBe(true);
  }
});

test('personal image URIs migrate with the iOS container and unowned picker sources are refused', () => {
  const run = harness();
  const theme = run.install('first');
  expect(() =>
    run.repository.setArtworkImage(theme.id, 'home.artwork', 'file:///picker/original.png')
  ).toThrow('app theme library');
  run.repository.setArtworkImage(theme.id, 'launch.artwork', shared);
  expect(run.stored()).not.toContain(directory);
  const relocated = 'file:///other-container/Documents/theme-assets-v1';
  const restored = new ThemeRepository(
    run.storage,
    () => 'unused',
    (uri) => uri.startsWith(relocated + '/'),
    createThemeAssetPaths(relocated)
  );
  expect(restored.hydrate().themes[0].artworkImages?.['launch.artwork']).toBe(
    shared.replace(directory, relocated)
  );
});

test('export packages carry effective image bytes and safe paths, never personal URIs or author sources', () => {
  const run = harness();
  const theme = run.install('first');
  run.repository.setArtworkImage(theme.id, 'launch.artwork', shared);
  run.repository.setArtworkImage(theme.id, 'home.artwork', replacement);
  const installed = run.repository.snapshot().themes[0];
  installed.manifest.source = 'https://example.invalid/private-source';
  const exported = exportThemePackage(installed, (uri) => ({
    bytes: new Uint8Array([uri === shared ? 1 : 2]),
    format: 'png',
    sha256: uri.split('/').at(-1)!.split('.')[0],
  }));
  const imported = unpackTheme(exported);
  const serialized = new TextDecoder().decode(exported);
  expect(serialized).not.toContain('file:///');
  expect(serialized).not.toContain('private-source');
  expect(imported.manifest.source).toBeUndefined();
  expect(Object.keys(imported.assets)).toHaveLength(2);
  expect(
    imported.assets[
      resolveThemeImage(imported.manifest, 'launch.artwork', 'dark', 'compact')!.asset
    ]
  ).toEqual(new Uint8Array([1]));
  expect(
    imported.assets[resolveThemeImage(imported.manifest, 'home.artwork', 'light', 'regular')!.asset]
  ).toEqual(new Uint8Array([2]));
  expect(installed.assets.authored).toBe(author);
});

test('a full authored asset catalog still previews personal images and exports within package bounds', () => {
  const run = harness();
  const manifest = createThemeStarter();
  manifest.assets = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [`a${i}`, { path: `assets/a${i}.png` }])
  );
  manifest.decoration = { 'home.artwork': { asset: 'a0' } };
  manifest.icons = { 'chrome.back': { asset: 'a1', render: 'template' } };
  manifest.variantDecorations = {
    dark: { 'shell.wallpaper': { asset: 'a2', regular: { asset: 'a3' } } },
  };
  manifest.homeIdentity = { logo: { mode: 'custom', asset: 'a4' } };
  manifest.preview = 'a5';
  const installed = run.repository.save(
    JSON.stringify(manifest),
    Object.fromEntries(Object.keys(manifest.assets).map((id) => [id, author]))
  );
  run.repository.setArtworkImage(installed.id, 'launch.artwork', shared);
  run.repository.setArtworkImage(installed.id, 'home.artwork', replacement);
  const current = run.repository.snapshot().themes[0];
  const preview = resolveCandidateTheme(current.manifest, current.assets, current);
  expect(Object.keys(preview.manifest.assets!)).toHaveLength(34);
  expect(resolveLaunchArtwork(preview, effectiveThemeAssets(current), 'dark')).toEqual({
    kind: 'artwork',
    uri: shared,
  });
  const output = unpackTheme(
    exportThemePackage(current, () => ({
      bytes: new Uint8Array([1]),
      format: 'png',
      sha256: 'a'.repeat(64),
    }))
  );
  expect(Object.keys(output.assets).sort()).toEqual(
    ['a1', 'a2', 'a3', 'a4', 'a5', 'personal-home-artwork', 'personal-launch-artwork'].sort()
  );
  expect(Object.keys(current.manifest.assets!)).toHaveLength(32);
});

test('new bundled revisions preserve personal images; removing the applied copy restores launch fallback on reload', () => {
  const run = harness();
  const theme = run.install('bundled-copy');
  run.repository.setArtworkImage(theme.id, 'launch.artwork', shared);
  run.repository.apply({ kind: 'custom', id: theme.id });
  const newer = { ...theme, id: 'builtin', manifest: { ...theme.manifest, version: '2.0.0' } };
  const restored = new ThemeRepository(
    run.storage,
    () => 'unused',
    (uri) => run.files.has(uri),
    createThemeAssetPaths(directory),
    newer
  );
  restored.hydrate();
  expect(restored.activeInstalled()?.manifest.version).toBe('2.0.0');
  expect(restored.activeInstalled()?.artworkImages?.['launch.artwork']).toBe(shared);
  restored.remove(theme.id);
  const reloaded = new ThemeRepository(
    run.storage,
    () => 'unused',
    (uri) => run.files.has(uri),
    createThemeAssetPaths(directory),
    newer
  );
  reloaded.hydrate();
  const active = reloaded.activeInstalled()!;
  expect(active.id).toBe('builtin');
  expect(active.artworkImages).toBeUndefined();
  expect(resolveLaunchArtwork(reloaded.active(), effectiveThemeAssets(active), 'light')).toEqual({
    kind: 'artwork',
    uri: author,
  });
});

test('missing or malformed personal references keep the authored theme usable and suspend destructive GC', () => {
  for (const broken of [
    { 'home.artwork': 'theme-assets-v1/' + 'd'.repeat(64) + '.png' },
    { futureSlot: shared },
    [],
  ]) {
    const run = harness();
    run.install('first');
    const raw = JSON.parse(run.stored()!);
    raw.themes[0].artworkImages = broken;
    run.storage.write(JSON.stringify(raw));
    const restored = new ThemeRepository(
      run.storage,
      () => 'unused',
      (uri) => run.files.has(uri),
      createThemeAssetPaths(directory)
    );
    expect(restored.hydrate().themes).toHaveLength(1);
    expect(restored.snapshot().themes[0].artworkImages).toBeUndefined();
    expect(restored.hasAuthoritativeAssetReferences()).toBe(false);
  }
});
