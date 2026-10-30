import { packTheme } from './package';
import { effectiveThemeAssets, effectiveThemeManifest, type InstalledTheme } from './repository';

/** The native adapter verifies ownership, image contents and the content hash first. */
export function exportThemePackage(
  theme: InstalledTheme,
  read: (uri: string) => { bytes: Uint8Array; format: string; sha256: string }
): Uint8Array {
  const manifest = effectiveThemeManifest(theme);
  delete manifest.source;
  delete manifest.assets;
  // Replaced images can leave authored files unused. Keep only references in the
  // effective manifest, without discarding the originals from the installation.
  const referenced = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'asset' && typeof child === 'string') referenced.add(child);
      else visit(child);
    }
  };
  visit(manifest);
  if (manifest.preview) referenced.add(manifest.preview);
  manifest.assets = {};
  const assets: Record<string, Uint8Array> = {};
  for (const [id, uri] of Object.entries(effectiveThemeAssets(theme))) {
    if (!referenced.has(id)) continue;
    const { bytes, format, sha256 } = read(uri);
    manifest.assets[id] = { path: `assets/${id}.${format}`, sha256 };
    assets[id] = bytes;
  }
  return packTheme({ manifest, assets });
}
