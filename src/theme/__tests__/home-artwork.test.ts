import { describe, expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/starter';
import {
  HOME_ARTWORK_SLOT,
  isHomeArtworkAvailable,
  isHomeArtworkPreference,
  resolveHomeArtworkAsset,
  resolveHomeArtwork,
  type HomeArtworkPreference,
} from '@/theme/home-artwork';
import type { ThemeManifest } from '@/theme/schema';

/** A foreground image and its author-controlled visibility. */
function pack({
  artwork,
  authored,
}: { artwork?: boolean; authored?: 'default' | 'hidden' } = {}): ThemeManifest {
  const manifest: ThemeManifest = {
    ...createThemeStarter(),
    assets: artwork ? { crest: { path: 'assets/crest.png' } } : {},
    decoration: artwork ? { [HOME_ARTWORK_SLOT]: { asset: 'crest', fit: 'contain' } } : {},
  };
  if (authored) manifest.homeIdentity = { artwork: { mode: authored } };
  return manifest;
}

const resolve = (manifest: ThemeManifest | undefined, preference: HomeArtworkPreference) =>
  resolveHomeArtwork({ manifest, mode: 'light', width: 'compact', preference });

describe('the Home artwork', () => {
  test('is nothing at all without a custom theme', () => {
    for (const preference of ['theme', 'shown', 'hidden'] as const) {
      expect(resolve(undefined, preference)).toBeNull();
    }
  });

  test('follows the author by default: a declared slot shows, an absent one does not', () => {
    expect(resolve(pack({ artwork: true }), 'theme')).toEqual({
      slot: HOME_ARTWORK_SLOT,
      image: { asset: 'crest', fit: 'contain' },
    });
    expect(resolve(pack(), 'theme')).toBeNull();
  });

  test('an author can ship the artwork with the switch off', () => {
    expect(resolve(pack({ artwork: true, authored: 'hidden' }), 'theme')).toBeNull();
    // And `default` is the same answer as saying nothing, rather than a third one.
    expect(resolve(pack({ artwork: true, authored: 'default' }), 'theme')).toEqual(
      resolve(pack({ artwork: true }), 'theme')
    );
  });

  test('the reader overrides the author in both directions', () => {
    expect(resolve(pack({ artwork: true, authored: 'hidden' }), 'shown')).toEqual({
      slot: HOME_ARTWORK_SLOT,
      image: { asset: 'crest', fit: 'contain' },
    });
    expect(resolve(pack({ artwork: true }), 'hidden')).toBeNull();
  });

  test('"shown" on a pack without artwork is still nothing', () => {
    expect(resolve(pack(), 'shown')).toBeNull();
  });

  test('drawable presence requires the resolved theme asset file', () => {
    const manifest = pack({ artwork: true });
    const drawable = resolveHomeArtworkAsset({
      manifest,
      assets: { crest: 'file:///themes/crest.png' },
      mode: 'light',
      width: 'compact',
    });
    expect(drawable).toEqual({
      resolved: {
        slot: HOME_ARTWORK_SLOT,
        image: { asset: 'crest', fit: 'contain' },
      },
      source: 'file:///themes/crest.png',
    });
    expect(isHomeArtworkAvailable(drawable)).toBe(true);
    expect(isHomeArtworkAvailable(drawable, 'file:///themes/crest.png')).toBe(false);
    expect(
      resolveHomeArtworkAsset({ manifest, assets: {}, mode: 'light', width: 'compact' })
    ).toBeNull();
    expect(isHomeArtworkAvailable(null)).toBe(false);
    expect(
      resolveHomeArtworkAsset({
        manifest,
        assets: { crest: 'https://example.test/crest.png' },
        mode: 'light',
        width: 'compact',
      })
    ).toBeNull();
    expect(
      resolveHomeArtworkAsset({
        manifest: pack({ artwork: true, authored: 'hidden' }),
        assets: { crest: 'file:///themes/crest.png' },
        mode: 'light',
        width: 'compact',
      })
    ).toBeNull();
  });

  test('per-mode and per-width overrides apply exactly as they do to any slot', () => {
    const manifest: ThemeManifest = {
      ...createThemeStarter(),
      assets: {
        crest: { path: 'assets/crest.png' },
        wide: { path: 'assets/wide.png' },
        night: { path: 'assets/night.png' },
      },
      decoration: {
        [HOME_ARTWORK_SLOT]: {
          asset: 'crest',
          fit: 'contain',
          regular: { asset: 'wide', fit: 'contain' },
        },
      },
      variantDecorations: { dark: { [HOME_ARTWORK_SLOT]: { asset: 'night', fit: 'contain' } } },
    };
    const at = (mode: 'light' | 'dark', width: 'compact' | 'regular') =>
      resolveHomeArtwork({ manifest, mode, width, preference: 'theme' })?.image.asset;
    expect(at('light', 'compact')).toBe('crest');
    expect(at('light', 'regular')).toBe('wide');
    expect(at('dark', 'compact')).toBe('night');
  });

  test('a null override removes the artwork the way it removes any other slot', () => {
    const manifest: ThemeManifest = {
      ...createThemeStarter(),
      assets: { crest: { path: 'assets/crest.png' } },
      decoration: { [HOME_ARTWORK_SLOT]: { asset: 'crest', fit: 'contain' } },
      variantDecorations: { dark: { [HOME_ARTWORK_SLOT]: null } },
    };
    expect(resolveHomeArtwork({ manifest, mode: 'light', width: 'compact' })).not.toBeNull();
    expect(resolveHomeArtwork({ manifest, mode: 'dark', width: 'compact' })).toBeNull();
  });

  test('the reader-wide decoration opt-out silences artwork too', () => {
    expect(
      resolveHomeArtwork({
        manifest: pack({ artwork: true }),
        mode: 'light',
        width: 'compact',
        preference: 'shown',
        decorationsEnabled: false,
      })
    ).toBeNull();
  });
  test('a compact opt-out leaves regular artwork available', () => {
    const manifest = pack({ artwork: true });
    manifest.decoration!['home.artwork'] = { asset: 'crest', compact: null };
    expect(resolveHomeArtwork({ manifest, mode: 'light', width: 'compact' })).toBeNull();
    expect(resolveHomeArtwork({ manifest, mode: 'light', width: 'regular' })?.slot).toBe(
      HOME_ARTWORK_SLOT
    );
  });

  test('only the three preferences are preferences', () => {
    for (const value of ['theme', 'shown', 'hidden'])
      expect(isHomeArtworkPreference(value)).toBe(true);
    for (const value of ['default', '', null, undefined, 0, true])
      expect(isHomeArtworkPreference(value)).toBe(false);
  });
});
