import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeImage, ThemeManifest, ThemeSlot } from '@/theme/schema';

export const HOME_ARTWORK_SLOT: ThemeSlot = 'home.artwork';

/** A reader override shared by Classic and Editorial Home. */
export type HomeArtworkPreference = 'theme' | 'shown' | 'hidden';
export const HOME_ARTWORK_PREFERENCES: readonly HomeArtworkPreference[] = [
  'theme',
  'shown',
  'hidden',
];

export function isHomeArtworkPreference(value: unknown): value is HomeArtworkPreference {
  return value === 'theme' || value === 'shown' || value === 'hidden';
}

export type ResolvedHomeArtwork = { slot: ThemeSlot; image: ThemeImage };
export type ResolvedHomeArtworkAsset = { resolved: ResolvedHomeArtwork; source: string };

export function isHomeArtworkAvailable(
  resolution: ResolvedHomeArtworkAsset | null,
  failedSource?: string | null
): resolution is ResolvedHomeArtworkAsset {
  return resolution !== null && resolution.source !== failedSource;
}

/** One foreground for every Home layout; empty-state art belongs to its own surface. */
export function resolveHomeArtwork({
  manifest,
  mode,
  width,
  preference = 'theme',
  decorationsEnabled = true,
}: {
  manifest: ThemeManifest | undefined;
  mode: 'light' | 'dark';
  width: 'compact' | 'regular';
  preference?: HomeArtworkPreference;
  decorationsEnabled?: boolean;
}): ResolvedHomeArtwork | null {
  if (!manifest || preference === 'hidden') return null;
  if (preference === 'theme' && manifest.homeIdentity?.artwork?.mode === 'hidden') return null;
  const image = resolveThemeImage(manifest, HOME_ARTWORK_SLOT, mode, width, decorationsEnabled);
  return image ? { slot: HOME_ARTWORK_SLOT, image } : null;
}

export function resolveHomeArtworkAsset({
  assets,
  ...options
}: Parameters<typeof resolveHomeArtwork>[0] & {
  assets: Record<string, string> | undefined;
}): ResolvedHomeArtworkAsset | null {
  const resolved = resolveHomeArtwork(options);
  if (!resolved) return null;
  const source = assets?.[resolved.image.asset];
  return source?.startsWith('file:///') ? { resolved, source } : null;
}
