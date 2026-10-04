import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMeasurableHeroUri } from '@/lib/launch-hero-edge';
import { isRenderableThemeAsset, registerBundledThemeAssets } from '@/theme/renderable-asset';
import {
  BUILTIN_THEME_INSTALLATION_ID,
  ThemeRepository,
  type InstalledTheme,
} from '@/theme/repository';
import { parseThemeManifest } from '@/theme/schema';
import { createThemeStarter } from '@/theme/starter';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const themeDir = join(root, 'assets', 'themes', 'cover-courier');
const manifest = parseThemeManifest(readFileSync(join(themeDir, 'theme.json'), 'utf8'));

function builtin(): InstalledTheme {
  return {
    id: BUILTIN_THEME_INSTALLATION_ID,
    manifest,
    assets: Object.fromEntries(
      Object.keys(manifest.assets ?? {}).map((id) => [id, `bundled-${id}`])
    ),
  };
}

function setup(withBuiltin = true) {
  let value: string | undefined;
  let sequence = 0;
  const repository = new ThemeRepository(
    { read: () => value, write: (next) => void (value = next) },
    () => `installed-${++sequence}`,
    undefined,
    undefined,
    withBuiltin ? builtin() : null
  );
  repository.hydrate();
  return repository;
}

const mine = (id: string) => JSON.stringify({ ...createThemeStarter(), id, name: id });

test('with no theme of their own the reader wears the built-in one', () => {
  const repository = setup();
  expect(repository.snapshot().themes).toEqual([]);
  expect(repository.active()?.label).toBe('Cover Courier');
  expect(repository.active()?.installationId).toBe(BUILTIN_THEME_INSTALLATION_ID);
  expect(repository.activeInstalled()?.assets['courier-light']).toBe('bundled-courier-light');
  expect(repository.active()?.manifest.homeIdentity?.name).toEqual({
    mode: 'custom',
    text: 'MUQUN',
  });
});

test('an earlier colour-pack selection does not outrank the built-in theme', () => {
  const repository = setup();
  repository.apply({ kind: 'builtin', id: 'dracula' });
  expect(repository.active()?.installationId).toBe(BUILTIN_THEME_INSTALLATION_ID);
});

test('one theme of their own takes over, and removing the last brings the built-in back', () => {
  const repository = setup();
  const installed = repository.save(mine('first'));
  repository.apply({ kind: 'custom', id: installed.id });
  expect(repository.active()?.installationId).toBe(installed.id);
  expect(repository.activeInstalled()?.id).toBe(installed.id);

  // With a theme of their own installed, the selection decides as it always did.
  repository.apply({ kind: 'builtin', id: 'dracula' });
  expect(repository.active()).toBeNull();

  repository.remove(installed.id);
  expect(repository.snapshot().themes).toEqual([]);
  expect(repository.active()?.installationId).toBe(BUILTIN_THEME_INSTALLATION_ID);
});

test('the built-in theme is not counted, listed, selectable or removable', () => {
  const repository = setup();
  expect(() => repository.apply({ kind: 'custom', id: BUILTIN_THEME_INSTALLATION_ID })).toThrow();
  repository.remove(BUILTIN_THEME_INSTALLATION_ID);
  expect(repository.active()?.installationId).toBe(BUILTIN_THEME_INSTALLATION_ID);
  const installed = repository.save(mine('second'));
  expect(repository.snapshot().themes.map((theme) => theme.id)).toEqual([installed.id]);
});

test('a library hydrated from storage keeps the rule', () => {
  let value: string | undefined;
  const storage = { read: () => value, write: (next: string) => void (value = next) };
  const first = new ThemeRepository(storage, () => 'abc', undefined, undefined, builtin());
  first.hydrate();
  first.apply({ kind: 'custom', id: first.save(mine('kept')).id });
  const second = new ThemeRepository(storage, () => 'def', undefined, undefined, builtin());
  second.hydrate();
  expect(second.active()?.installationId).toBe('abc');
});

test('without the built-in theme the app keeps its code fallback', () => {
  expect(setup(false).active()).toBeNull();
});

test('only app-owned or registered bundled URIs are renderable', () => {
  expect(isRenderableThemeAsset('file:///data/theme.webp')).toBe(true);
  expect(isRenderableThemeAsset('https://example.com/a.webp')).toBe(false);
  expect(isRenderableThemeAsset('assets_themes_covercourier_assets_paperlight')).toBe(false);
  registerBundledThemeAssets(['assets_themes_covercourier_assets_paperlight']);
  expect(isRenderableThemeAsset('assets_themes_covercourier_assets_paperlight')).toBe(true);
  // The opening decodes the built-in picture in its canvas, as it does a file.
  expect(isMeasurableHeroUri('assets_themes_covercourier_assets_paperlight')).toBe(true);
  expect(isMeasurableHeroUri('splashscreen_logo')).toBe(false);
  expect(isRenderableThemeAsset(undefined)).toBe(false);
});

test('the committed built-in pack matches its manifest and generated module', () => {
  const generated = readFileSync(join(root, 'src/theme/builtin-theme.generated.ts'), 'utf8');
  expect(generated).toContain(`BUILTIN_THEME_VERSION = '${manifest.version}'`);
  const paths = Object.entries(manifest.assets ?? {}).map(([id, asset]) => {
    expect('path' in asset).toBe(true);
    const path = (asset as { path: string }).path;
    expect(existsSync(join(themeDir, path))).toBe(true);
    expect(generated).toContain(`require('../../assets/themes/cover-courier/${path}')`);
    expect(new RegExp(`['"]?${id}['"]?: require`).test(generated)).toBe(true);
    return path.slice('assets/'.length);
  });
  // Nothing ships that the manifest does not name.
  expect(readdirSync(join(themeDir, 'assets')).sort()).toEqual(paths.sort());
  expect(generated.match(/require\('\.\.\/\.\.\/assets\/themes\/[^']+\/assets\//g)?.length).toBe(
    paths.length
  );
  // The home artwork and the Pad cover wallpaper are both present in each mode.
  for (const mode of ['light', 'dark'] as const) {
    expect(manifest.variantDecorations?.[mode]?.['home.artwork']?.asset).toBe(`courier-${mode}`);
    expect(manifest.variantDecorations?.[mode]?.['home.wallpaper']?.asset).toBe(`paper-${mode}`);
  }
});
