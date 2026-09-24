import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/starter';
import { resolveLaunchArtwork, resolveLaunchBackground } from '@/theme/launch-artwork';
import { effectiveThemeManifest } from '@/theme/repository';
import { compileTheme } from '@/theme/resolve';
import type { ThemeManifest } from '@/theme/schema';

const FILES = {
  picture: 'file:///themes/installed/picture.png',
  mark: 'file:///themes/installed/mark.png',
  wide: 'file:///themes/installed/wide.png',
};

function theme(edit: (manifest: ThemeManifest) => void) {
  const manifest = createThemeStarter();
  manifest.assets = {
    picture: { path: 'assets/picture.png' },
    mark: { path: 'assets/mark.png' },
    wide: { path: 'assets/wide.png' },
  };
  edit(manifest);
  return compileTheme(manifest, 'installed-1');
}

test('no pack, or a pack with neither picture nor mark, keeps the bundled mark', () => {
  expect(resolveLaunchArtwork(null, FILES, 'light')).toEqual({ kind: 'default' });
  expect(resolveLaunchArtwork(undefined, FILES, 'light')).toEqual({ kind: 'default' });
  const plain = theme(() => {});
  expect(resolveLaunchArtwork(plain, FILES, 'light')).toEqual({ kind: 'default' });
  // A pack whose assets never made it onto disk is the same situation.
  expect(resolveLaunchArtwork(plain, undefined, 'light')).toEqual({ kind: 'default' });
});

test('the primary Home artwork is the default launch picture', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'home.artwork': { asset: 'picture' } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light')).toEqual({
    kind: 'artwork',
    uri: FILES.picture,
  });
});

test('the home logo is the second answer, and a hidden one is not an answer at all', () => {
  const custom = theme((manifest) => {
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(custom, FILES, 'dark')).toEqual({ kind: 'logo', uri: FILES.mark });

  const hidden = theme((manifest) => {
    manifest.homeIdentity = { logo: { mode: 'hidden' } };
  });
  expect(resolveLaunchArtwork(hidden, FILES, 'dark')).toEqual({ kind: 'default' });

  // `mode: 'default'` asks for the app's own mark back, which is the bundled one.
  const app = theme((manifest) => {
    manifest.homeIdentity = { logo: { mode: 'default' } };
  });
  expect(resolveLaunchArtwork(app, FILES, 'dark')).toEqual({ kind: 'default' });
});

test("the reader's Show Home logo switch hides the launch logo too", () => {
  // The switch is not a parameter here: `effectiveThemeManifest` has already
  // rewritten the authored logo by the time a theme is compiled, so the
  // preference and an authored `hidden` are the same manifest.
  const manifest = createThemeStarter();
  manifest.assets = { mark: { path: 'assets/mark.png' } };
  manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };

  const shown = compileTheme(
    effectiveThemeManifest({ id: 'a', manifest, assets: {}, hideHomeLogo: false }),
    'a'
  );
  expect(resolveLaunchArtwork(shown, FILES, 'light')).toEqual({ kind: 'logo', uri: FILES.mark });

  const hidden = compileTheme(
    effectiveThemeManifest({ id: 'a', manifest, assets: {}, hideHomeLogo: true }),
    'a'
  );
  expect(resolveLaunchArtwork(hidden, FILES, 'light')).toEqual({ kind: 'default' });
});

test('only an app-owned file is rendered, so an uninstalled asset falls through', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'home.artwork': { asset: 'picture' } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  // The picture's download failed; the mark's did not.
  expect(resolveLaunchArtwork(pack, { mark: FILES.mark }, 'light')).toEqual({
    kind: 'logo',
    uri: FILES.mark,
  });
  // An author URL is never a source, even when the map somehow carries one.
  expect(
    resolveLaunchArtwork(pack, { picture: 'https://example.com/picture.png' }, 'light')
  ).toEqual({ kind: 'default' });
});

test('mode overrides and width overrides choose the picture the same way artwork does', () => {
  const pack = theme((manifest) => {
    manifest.decoration = {
      'home.artwork': { asset: 'picture', regular: { asset: 'wide' } },
    };
    manifest.variantDecorations = { dark: { 'home.artwork': null } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'compact')).toEqual({
    kind: 'artwork',
    uri: FILES.picture,
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'regular')).toEqual({
    kind: 'artwork',
    uri: FILES.wide,
  });
  // Dark removes the slot explicitly, so dark launches on the mark instead.
  expect(resolveLaunchArtwork(pack, FILES, 'dark', 'compact')).toEqual({
    kind: 'logo',
    uri: FILES.mark,
  });
});

test("the launch floor is the pack's own background, and nothing without a pack", () => {
  const pack = theme(() => {});
  expect(resolveLaunchBackground(null, 'light')).toBeNull();
  expect(resolveLaunchBackground(undefined, 'dark')).toBeNull();
  expect(resolveLaunchBackground(pack, 'light')).toBe(pack.light.colors.background);
  expect(resolveLaunchBackground(pack, 'dark')).toBe(pack.dark.colors.background);
  expect(pack.light.colors.background).not.toBe(pack.dark.colors.background);
});

test('an explicit launch override wins over Home artwork', () => {
  const pack = theme((manifest) => {
    manifest.decoration = {
      'launch.artwork': { asset: 'wide' },
      'home.artwork': { asset: 'picture' },
    };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light')).toEqual({
    kind: 'artwork',
    uri: FILES.wide,
  });
  expect(resolveLaunchArtwork(pack, { picture: FILES.picture }, 'light')).toEqual({
    kind: 'artwork',
    uri: FILES.picture,
  });
});

test('Home visibility does not hide artwork on launch', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'home.artwork': { asset: 'wide' } };
    manifest.homeIdentity = { artwork: { mode: 'hidden' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light')).toEqual({
    kind: 'artwork',
    uri: FILES.wide,
  });
  expect(resolveLaunchArtwork(pack, { mark: FILES.mark }, 'light')).toEqual({
    kind: 'default',
  });
});

test('variant launch art stays independent from Home in both widths and modes', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'home.artwork': { asset: 'picture' } };
    manifest.variantDecorations = {
      light: { 'launch.artwork': { asset: 'wide' } },
      dark: { 'launch.artwork': { asset: 'mark' } },
    };
  });
  for (const width of ['compact', 'regular'] as const) {
    expect(resolveLaunchArtwork(pack, FILES, 'light', width)).toEqual({
      kind: 'artwork',
      uri: FILES.wide,
    });
    expect(resolveLaunchArtwork(pack, FILES, 'dark', width)).toEqual({
      kind: 'artwork',
      uri: FILES.mark,
    });
  }
});
