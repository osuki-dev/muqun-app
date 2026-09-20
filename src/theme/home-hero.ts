import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeImage, ThemeManifest, ThemeSlot } from '@/theme/schema';

/** The pack's own picture, and the slot the app falls back to when it asked for one. */
export const HOME_HERO_SLOT: ThemeSlot = 'home.hero';
export const HOME_HERO_FALLBACK_SLOT: ThemeSlot = 'emptyState.illustration';

/**
 * The reader's answer for this installation, on top of the author's.
 *
 * `theme` is not a third state so much as the absence of one: it means "whatever
 * the pack says", which is what every install starts on and what
 * `resetAppearancePreferences` puts it back to.
 */
export type HomeHeroPreference = 'theme' | 'shown' | 'hidden';

export const HOME_HERO_PREFERENCES: readonly HomeHeroPreference[] = ['theme', 'shown', 'hidden'];

export function isHomeHeroPreference(value: unknown): value is HomeHeroPreference {
  return value === 'theme' || value === 'shown' || value === 'hidden';
}

export type ResolvedHomeHero = {
  /** Which slot the picture actually came from, so a caller can say so. */
  slot: ThemeSlot;
  image: ThemeImage;
};

/**
 * A resolved hero is drawable only when its app-owned asset is present too.
 * Keeping that answer beside `resolveHomeHero` lets a composition decide
 * whether to reserve a masthead band without inspecting a React element.
 */
export type ResolvedHomeHeroAsset = {
  resolved: ResolvedHomeHero;
  source: string;
};

/** Keep a failed source from reserving a masthead band on its next render. */
export function isHomeHeroAvailable(
  resolution: ResolvedHomeHeroAsset | null,
  failedSource?: string | null
): resolution is ResolvedHomeHeroAsset {
  return resolution !== null && resolution.source !== failedSource;
}

/**
 * What Home draws between its header and its server list, if anything.
 *
 * Two decisions, in this order, and keeping them apart is the whole point of
 * this module:
 *
 * 1. **Is there a hero at all?** The author's default is `homeIdentity.hero`,
 *    which says `hidden` or `default`; `default`, and saying nothing, both mean
 *    "show it if I drew one". The reader's `preference` overrides that in either
 *    direction and `theme` declines to.
 *
 * 2. **Which picture?** `home.hero` when the pack declares it. Otherwise --
 *    and *only* when the reader asked for a hero by name -- `emptyState.illustration`,
 *    the one other square, self-contained picture a pack is defined to have.
 *
 * The asymmetry in step 2 is deliberate and is the rule most likely to be
 * "simplified" away later. An author who writes `hero: { mode: 'default' }`
 * without drawing one has said nothing about their empty-state art, and hoisting
 * it onto Home on their behalf is the app redecorating a pack it did not write:
 * the illustration was composed to sit inside a card under two lines of copy,
 * not to head a page. A reader who moves the switch to `Shown` has asked for
 * something, though, and answering "your theme has no hero" when the pack
 * plainly contains a picture is a worse answer than showing it. So the fallback
 * is reachable only from an explicit `shown`.
 *
 * `decorationsEnabled` and the width/mode selection are passed straight through
 * to {@link resolveThemeImage}, so a hero inherits, overrides and opts out on
 * exactly the same terms as every other slot.
 */
export function resolveHomeHero({
  manifest,
  mode,
  width,
  preference = 'theme',
  decorationsEnabled = true,
}: {
  manifest: ThemeManifest | undefined;
  mode: 'light' | 'dark';
  width: 'compact' | 'regular';
  preference?: HomeHeroPreference;
  decorationsEnabled?: boolean;
}): ResolvedHomeHero | null {
  if (!manifest) return null;
  const hero = resolveThemeImage(manifest, HOME_HERO_SLOT, mode, width, decorationsEnabled);
  const authored = manifest.homeIdentity?.hero?.mode === 'hidden' ? 'hidden' : 'default';
  const visible =
    preference === 'theme' ? authored === 'default' && Boolean(hero) : preference === 'shown';
  if (!visible) return null;
  if (hero) return { slot: HOME_HERO_SLOT, image: hero };
  if (preference !== 'shown') return null;
  const fallback = resolveThemeImage(
    manifest,
    HOME_HERO_FALLBACK_SLOT,
    mode,
    width,
    decorationsEnabled
  );
  return fallback ? { slot: HOME_HERO_FALLBACK_SLOT, image: fallback } : null;
}

/** Resolve the hero and its installed file as one drawable presence decision. */
export function resolveHomeHeroAsset({
  manifest,
  assets,
  mode,
  width,
  preference = 'theme',
  decorationsEnabled = true,
}: {
  manifest: ThemeManifest | undefined;
  assets: Record<string, string> | undefined;
  mode: 'light' | 'dark';
  width: 'compact' | 'regular';
  preference?: HomeHeroPreference;
  decorationsEnabled?: boolean;
}): ResolvedHomeHeroAsset | null {
  const resolved = resolveHomeHero({ manifest, mode, width, preference, decorationsEnabled });
  if (!resolved) return null;
  const source = assets?.[resolved.image.asset];
  return source?.startsWith('file:///') ? { resolved, source } : null;
}
