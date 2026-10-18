import { Image } from 'expo-image';

import { prepareSharedSkiaImages } from '@/lib/skia-image-cache';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';
import { THEME_SLOTS, type ThemeManifest } from '@/theme/schema';

/** Decode the active variant before changing the palette or dismissing its preview. */
export async function prepareThemeArtwork(
  manifest: ThemeManifest,
  assets: Record<string, string> | undefined,
  mode: 'light' | 'dark',
  width: number
): Promise<() => void> {
  const native = new Set<string>();
  const skia = new Set<string>();
  for (const slot of THEME_SLOTS) {
    const image = resolveThemeImage(manifest, slot, mode, width >= 768 ? 'regular' : 'compact');
    const uri = image ? assets?.[image.asset] : undefined;
    if (!isRenderableThemeAsset(uri)) continue;
    native.add(uri);
    if (slot === 'home.artwork') skia.add(uri);
  }
  const [release] = await Promise.all([
    prepareSharedSkiaImages([...skia]),
    Promise.all([...native].map((uri) => Image.prefetch(uri, 'memory').catch(() => false))),
  ]);
  return release;
}
