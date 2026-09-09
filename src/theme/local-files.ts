import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';
import { unpackTheme } from '@/theme/package';
import { prepareThemeAssets, type PreparedThemeAssets } from '@/theme/assets';

export type ThemeFilePreview = { manifest: ThemeManifest; prepared?: PreparedThemeAssets };

/** Explicit user selection only; no clipboard inspection or network requests. */
export async function pickThemeManifest(): Promise<ThemeFilePreview | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Providers do not consistently classify our custom extension. Let the user
    // select it, then enforce byte limits and strict JSON/ZIP validation below.
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    const packaged = /\.(muqun-theme|zip)$/i.test(asset.name);
    const limit = packaged ? THEME_LIMITS.packageBytes : THEME_LIMITS.manifestBytes;
    if (asset.size !== undefined && asset.size > limit)
      throw new Error('Theme file exceeds the import size limit');
    if (!file.exists || file.size > limit)
      throw new Error('Theme file is unavailable or exceeds the import size limit');
    if (packaged) {
      const theme = unpackTheme(await file.bytes());
      const prepared = await prepareThemeAssets(theme);
      return { manifest: theme.manifest, prepared };
    }
    const text = await file.text();
    return { manifest: parseThemeManifest(text) };
  } finally {
    // Expo owns this freshly made copy. Never delete the original selected file.
    const pickerCache = new Directory(Paths.cache, 'DocumentPicker').uri + '/';
    if (file.uri.startsWith(pickerCache)) {
      try {
        if (file.exists) file.delete();
      } catch {
        /* OS cache eviction remains available. */
      }
    }
  }
}

/** Export only theme data. The platform share sheet controls its destination. */
export async function shareThemeColors(text: string): Promise<void> {
  const manifest = parseThemeManifest(text);
  await shareThemeFile(`${manifest.id}.muqun-theme.json`, JSON.stringify(manifest, null, 2), false);
}

export async function shareThemeFile(
  name: string,
  data: string | Uint8Array,
  packaged: boolean
): Promise<void> {
  if (!/^[a-z][a-z0-9-]*\.muqun-theme(?:\.json)?$/.test(name))
    throw new Error('Invalid theme export filename');
  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  if (size > (packaged ? THEME_LIMITS.packageBytes : THEME_LIMITS.manifestBytes))
    throw new Error('Theme export exceeds the size limit');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable');
  const directory = new Directory(Paths.cache, 'theme-exports');
  directory.create({ intermediates: true, idempotent: true });
  // This module owns the directory; retain at most one manifest-sized export.
  for (const previous of directory.list()) if (previous instanceof File) previous.delete();
  const file = new File(directory, name);
  file.create({ overwrite: true });
  file.write(data);
  await Sharing.shareAsync(file.uri, {
    mimeType: packaged ? 'application/zip' : 'application/json',
    UTI: packaged ? 'public.zip-archive' : 'public.json',
  });
}
