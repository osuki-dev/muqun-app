import { expect, test } from 'bun:test';
import { createThemeAssetPaths } from '../asset-paths';
import { ThemeRepository } from '../repository';
import { createThemeStarter } from '../starter';
import { ThemeAssetLifecycle } from '../asset-lifecycle';

const name = `${'a'.repeat(64)}.png`;
const directory = (id: string) =>
  `file:///var/mobile/Containers/Data/Application/${id}/Documents/theme-assets-v1`;

test('legacy and relative assets survive repeated container moves with selection and preferences', () => {
  const manifest = createThemeStarter();
  manifest.assets = { picture: { path: 'assets/picture.png' } };
  let value = JSON.stringify({
    version: 1,
    themes: [
      {
        id: 'installed',
        manifest,
        assets: { picture: `${directory('OLD')}/${name}` },
        hideHomeLogo: true,
        surfaceBackgroundOpacity: 0.95,
      },
    ],
    selection: { kind: 'custom', id: 'installed' },
    previous: { kind: 'builtin', id: 'osuki' },
  });
  for (const container of ['NEW', 'NEXT']) {
    const uri = `${directory(container)}/${name}`;
    const repo = new ThemeRepository(
      {
        read: () => value,
        write: (next) => {
          value = next;
        },
      },
      () => 'new',
      (path) => path === uri,
      createThemeAssetPaths(directory(container))
    );
    const library = repo.hydrate();
    expect(library.themes).toHaveLength(1);
    expect(library.selection).toEqual({ kind: 'custom', id: 'installed' });
    expect(library.themes[0]?.hideHomeLogo).toBe(true);
    expect(library.themes[0]?.surfaceBackgroundOpacity).toBe(0.95);
    expect(library.themes[0]?.assets.picture).toBe(uri);
    expect(repo.hasAuthoritativeAssetReferences()).toBe(true);
    const lifecycle = new ThemeAssetLifecycle();
    lifecycle.replaceReferences(library.themes.flatMap((theme) => Object.values(theme.assets)));
    expect(lifecycle.canCollect(uri)).toBe(false);
    repo.apply({ kind: 'builtin', id: 'osuki' });
    repo.apply({ kind: 'custom', id: 'installed' });
    expect(JSON.parse(value).themes[0].assets.picture).toBe(`theme-assets-v1/${name}`);
    expect(value).not.toContain('/Containers/');
  }
});

test('rebasing rejects unowned paths and traversal; web leaves paths untouched', () => {
  const paths = createThemeAssetPaths(directory('NEW'));
  expect(
    paths.decode(
      `file:///Users/test/Library/Developer/CoreSimulator/Devices/DEVICE/data/Containers/Data/Application/OLD/Documents/theme-assets-v1/${name}`
    )
  ).toBe(`${directory('NEW')}/${name}`);
  for (const uri of [
    `https://example.com/${name}`,
    `theme-assets-v1/../${name}`,
    `theme-assets-v1/%2e%2e/${name}`,
    `file:///tmp/theme-assets-v1/${name}`,
    `${directory('OLD')}/other.png`,
  ]) {
    expect(paths.decode(uri)).toBe(uri);
  }
  expect(createThemeAssetPaths(null).decode(`theme-assets-v1/${name}`)).toBe(
    `theme-assets-v1/${name}`
  );
});

test('missing relocated files do not grant garbage collection authority or overwrite metadata', () => {
  const manifest = createThemeStarter();
  manifest.assets = { picture: { path: 'assets/picture.png' } };
  const value = JSON.stringify({
    version: 1,
    themes: [{ id: 'installed', manifest, assets: { picture: `theme-assets-v1/${name}` } }],
    selection: null,
    previous: null,
  });
  let writes = 0;
  const repo = new ThemeRepository(
    {
      read: () => value,
      write: () => {
        writes++;
      },
    },
    () => 'new',
    () => false,
    createThemeAssetPaths(directory('NEW'))
  );
  expect(repo.hydrate().themes).toHaveLength(0);
  expect(repo.hasAuthoritativeAssetReferences()).toBe(false);
  expect(writes).toBe(0);
});
