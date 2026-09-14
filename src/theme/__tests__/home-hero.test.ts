import { describe, expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
import {
  HOME_HERO_FALLBACK_SLOT,
  HOME_HERO_SLOT,
  isHomeHeroPreference,
  resolveHomeHero,
  type HomeHeroPreference,
} from '@/theme/home-hero';
import type { ThemeManifest } from '@/theme/schema';

/**
 * A pack with the two pictures this resolver chooses between, either of them
 * optional. Built off the authoring starter so the manifest under test is the
 * one an author would actually be handed.
 */
function pack({
  hero,
  illustration,
  authored,
}: {
  hero?: boolean;
  illustration?: boolean;
  authored?: 'default' | 'hidden';
} = {}): ThemeManifest {
  const manifest: ThemeManifest = {
    ...createThemeStarter(),
    assets: {
      ...(hero ? { crest: { path: 'assets/crest.png' as const } } : {}),
      ...(illustration ? { empty: { path: 'assets/empty.png' as const } } : {}),
    },
    decoration: {
      ...(hero ? { [HOME_HERO_SLOT]: { asset: 'crest', fit: 'contain' as const } } : {}),
      ...(illustration
        ? { [HOME_HERO_FALLBACK_SLOT]: { asset: 'empty', fit: 'contain' as const } }
        : {}),
    },
  };
  if (authored) manifest.homeIdentity = { hero: { mode: authored } };
  return manifest;
}

const resolve = (manifest: ThemeManifest | undefined, preference: HomeHeroPreference) =>
  resolveHomeHero({ manifest, mode: 'light', width: 'compact', preference });

describe('the Home hero', () => {
  test('is nothing at all without a custom theme', () => {
    for (const preference of ['theme', 'shown', 'hidden'] as const) {
      expect(resolve(undefined, preference)).toBeNull();
    }
  });

  test('follows the author by default: a declared slot shows, an absent one does not', () => {
    expect(resolve(pack({ hero: true }), 'theme')).toEqual({
      slot: HOME_HERO_SLOT,
      image: { asset: 'crest', fit: 'contain' },
    });
    expect(resolve(pack(), 'theme')).toBeNull();
  });

  test('an author can ship the artwork with the switch off', () => {
    expect(resolve(pack({ hero: true, authored: 'hidden' }), 'theme')).toBeNull();
    // And `default` is the same answer as saying nothing, rather than a third one.
    expect(resolve(pack({ hero: true, authored: 'default' }), 'theme')).toEqual(
      resolve(pack({ hero: true }), 'theme')
    );
  });

  test('the reader overrides the author in both directions', () => {
    expect(resolve(pack({ hero: true, authored: 'hidden' }), 'shown')).toEqual({
      slot: HOME_HERO_SLOT,
      image: { asset: 'crest', fit: 'contain' },
    });
    expect(resolve(pack({ hero: true }), 'hidden')).toBeNull();
  });

  /*
   * The asymmetry that is the whole point of the module, from both sides.
   *
   * A reader who asks for an illustration gets the pack's other square picture
   * when there is no hero; an author who asks for one and drew none gets
   * nothing, because the empty-state art was composed for a card and hoisting
   * it onto Home on the author's behalf is the app redecorating a pack it did
   * not write.
   */
  test('only an explicit reader "shown" reaches the empty-state illustration', () => {
    expect(resolve(pack({ illustration: true }), 'shown')).toEqual({
      slot: HOME_HERO_FALLBACK_SLOT,
      image: { asset: 'empty', fit: 'contain' },
    });
    expect(resolve(pack({ illustration: true, authored: 'default' }), 'theme')).toBeNull();
    expect(resolve(pack({ illustration: true }), 'hidden')).toBeNull();
  });

  test('a declared hero always wins over the fallback, whoever asked', () => {
    for (const preference of ['theme', 'shown'] as const) {
      expect(resolve(pack({ hero: true, illustration: true }), preference)?.slot).toBe(
        HOME_HERO_SLOT
      );
    }
  });

  test('"shown" on a pack with neither picture is still nothing', () => {
    expect(resolve(pack(), 'shown')).toBeNull();
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
        [HOME_HERO_SLOT]: {
          asset: 'crest',
          fit: 'contain',
          regular: { asset: 'wide', fit: 'contain' },
        },
      },
      variantDecorations: { dark: { [HOME_HERO_SLOT]: { asset: 'night', fit: 'contain' } } },
    };
    const at = (mode: 'light' | 'dark', width: 'compact' | 'regular') =>
      resolveHomeHero({ manifest, mode, width, preference: 'theme' })?.image.asset;
    expect(at('light', 'compact')).toBe('crest');
    expect(at('light', 'regular')).toBe('wide');
    expect(at('dark', 'compact')).toBe('night');
  });

  test('a null override removes the hero the way it removes any other slot', () => {
    const manifest: ThemeManifest = {
      ...createThemeStarter(),
      assets: { crest: { path: 'assets/crest.png' } },
      decoration: { [HOME_HERO_SLOT]: { asset: 'crest', fit: 'contain' } },
      variantDecorations: { dark: { [HOME_HERO_SLOT]: null } },
    };
    expect(resolveHomeHero({ manifest, mode: 'light', width: 'compact' })).not.toBeNull();
    expect(resolveHomeHero({ manifest, mode: 'dark', width: 'compact' })).toBeNull();
  });

  test('the reader-wide decoration opt-out silences the hero too', () => {
    // Including the fallback: "no artwork" has to mean no artwork, or the one
    // picture that survived the switch would be the one the app chose.
    for (const manifest of [pack({ hero: true }), pack({ illustration: true })]) {
      expect(
        resolveHomeHero({
          manifest,
          mode: 'light',
          width: 'compact',
          preference: 'shown',
          decorationsEnabled: false,
        })
      ).toBeNull();
    }
  });

  test('only the three preferences are preferences', () => {
    for (const value of ['theme', 'shown', 'hidden'])
      expect(isHomeHeroPreference(value)).toBe(true);
    for (const value of ['default', '', null, undefined, 0, true])
      expect(isHomeHeroPreference(value)).toBe(false);
  });
});
