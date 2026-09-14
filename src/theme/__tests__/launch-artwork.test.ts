import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
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

test('the empty-state illustration is the first answer', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'emptyState.illustration': { asset: 'picture' } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light')).toEqual({
    kind: 'illustration',
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
    manifest.decoration = { 'emptyState.illustration': { asset: 'picture' } };
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
      'emptyState.illustration': { asset: 'picture', regular: { asset: 'wide' } },
    };
    manifest.variantDecorations = { dark: { 'emptyState.illustration': null } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'compact')).toEqual({
    kind: 'illustration',
    uri: FILES.picture,
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'regular')).toEqual({
    kind: 'illustration',
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

test('the launch overlay asks for the home hero first, and only the launch overlay', () => {
  const pack = theme((manifest) => {
    manifest.decoration = {
      'home.hero': { asset: 'wide' },
      'emptyState.illustration': { asset: 'picture' },
    };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'mark' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'compact', { hero: true })).toEqual({
    kind: 'hero',
    uri: FILES.wide,
  });
  // The lock screen never sees the hero.
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'compact')).toEqual({
    kind: 'illustration',
    uri: FILES.picture,
  });
  // No hero drawn: the launch overlay falls through to the same chain.
  const noHero = theme((manifest) => {
    manifest.decoration = { 'emptyState.illustration': { asset: 'picture' } };
  });
  expect(resolveLaunchArtwork(noHero, FILES, 'light', 'compact', { hero: true })).toEqual({
    kind: 'illustration',
    uri: FILES.picture,
  });
});

test('an author who hid the hero keeps it off the launch screen too', () => {
  const pack = theme((manifest) => {
    manifest.decoration = { 'home.hero': { asset: 'wide' } };
    manifest.homeIdentity = { hero: { mode: 'hidden' } };
  });
  expect(resolveLaunchArtwork(pack, FILES, 'light', 'compact', { hero: true })).toEqual({
    kind: 'default',
  });
  // And a hero whose file never installed is no hero.
  const installed = theme((manifest) => {
    manifest.decoration = { 'home.hero': { asset: 'wide' } };
  });
  expect(
    resolveLaunchArtwork(installed, { mark: FILES.mark }, 'light', 'compact', { hero: true })
  ).toEqual({
    kind: 'default',
  });
});
