import { resolveHomeArtworkAsset } from '@/theme/home-artwork';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';

/** Reuse Home's art in a narrow rail, without registering a second launch target. */
export function resolvePadRailArtwork(
  options: Omit<Parameters<typeof resolveHomeArtworkAsset>[0], 'width'>
) {
  const foreground = resolveHomeArtworkAsset({ ...options, width: 'compact' });
  if (foreground) {
    if (foreground.resolved.image.opacity === 0) return null;
    return {
      source: foreground.source,
      image: foreground.resolved.image,
      foreground: true,
    };
  }
  const { manifest, assets, mode, preference, decorationsEnabled } = options;
  if (!manifest || preference === 'hidden' || decorationsEnabled === false) return null;
  // A declared but missing/disabled illustration is not a scene-only theme.
  if (resolveThemeImage(manifest, 'home.artwork', mode, 'compact')) return null;
  const image = resolveThemeImage(
    manifest,
    'home.wallpaper',
    mode,
    'compact',
    true,
    'shell.wallpaper'
  );
  const source = image ? assets?.[image.asset] : undefined;
  return image && image.opacity !== 0 && isRenderableThemeAsset(source)
    ? { source, image, foreground: false }
    : null;
}
