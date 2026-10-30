import type { ThemeManifest } from './schema';

export const THEME_ARTWORK_SLOTS = ['launch.artwork', 'home.artwork'] as const;
export type ThemeArtworkSlot = (typeof THEME_ARTWORK_SLOTS)[number];
export type ThemeArtworkImages = Partial<Record<ThemeArtworkSlot, string>>;

/** Personal images are independent of the author's asset names and variants. */
export function themeArtworkEntries(manifest: ThemeManifest, images?: ThemeArtworkImages) {
  const used = new Set(Object.keys(manifest.assets ?? {}));
  return THEME_ARTWORK_SLOTS.flatMap((slot) => {
    const uri = images?.[slot];
    if (!uri) return [];
    const base = slot === 'home.artwork' ? 'personal-home-artwork' : 'personal-launch-artwork';
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    return [{ slot, id, uri }];
  });
}

/** Include both authored and personal images when publishing durable references. */
export function themeAssetReferences(theme: {
  assets: Record<string, string>;
  artworkImages?: ThemeArtworkImages;
}): string[] {
  return [...Object.values(theme.assets), ...Object.values(theme.artworkImages ?? {})];
}
