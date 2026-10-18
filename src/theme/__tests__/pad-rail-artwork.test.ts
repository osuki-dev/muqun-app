import { expect, test } from 'bun:test';
import { resolvePadRailArtwork } from '@/theme/pad-rail-artwork';
import { createThemeStarter } from '@/theme/starter';
import type { ThemeManifest } from '@/theme/schema';

function scene(): ThemeManifest {
  return {
    ...createThemeStarter(),
    decoration: { 'home.wallpaper': { asset: 'scene', fit: 'cover', opacity: 0.8 } },
    variantDecorations: {},
  };
}
const assets = {
  scene: 'file:///scene.png',
  compact: 'file:///compact.png',
  dark: 'file:///dark.png',
};

test('rail reuses compact Home art and follows the current mode', () => {
  const manifest = scene();
  manifest.decoration!['home.artwork'] = {
    asset: 'unused',
    compact: { asset: 'compact', fit: 'contain' },
  };
  manifest.variantDecorations = { dark: { 'home.artwork': { asset: 'dark' } } };
  expect(resolvePadRailArtwork({ manifest, assets, mode: 'light' })?.source).toBe(assets.compact);
  expect(resolvePadRailArtwork({ manifest, assets, mode: 'dark' })?.source).toBe(assets.dark);
  expect(resolvePadRailArtwork({ manifest, assets, mode: 'light' })?.foreground).toBe(true);
});

test('scene-only themes reuse wallpaper, preserving fit, opacity and focal point', () => {
  const manifest = scene();
  manifest.decoration!['home.wallpaper']!.focalPoint = { x: 0.2, y: 0.7 };
  const result = resolvePadRailArtwork({ manifest, assets, mode: 'light' });
  expect(result).toEqual({
    source: assets.scene,
    foreground: false,
    image: manifest.decoration!['home.wallpaper']!,
  });
});

test('no art, invalid asset, failed foreground resolution and hidden art reserve no image', () => {
  expect(resolvePadRailArtwork({ manifest: undefined, assets, mode: 'light' })).toBeNull();
  expect(resolvePadRailArtwork({ manifest: scene(), assets: {}, mode: 'light' })).toBeNull();
  expect(
    resolvePadRailArtwork({ manifest: scene(), assets, mode: 'light', preference: 'hidden' })
  ).toBeNull();
  const manifest = scene();
  manifest.decoration!['home.artwork'] = { asset: 'missing' };
  expect(resolvePadRailArtwork({ manifest, assets, mode: 'light' })).toBeNull();
  manifest.decoration!['home.artwork'] = { asset: 'compact', opacity: 0 };
  expect(resolvePadRailArtwork({ manifest, assets, mode: 'light' })).toBeNull();
});
