import { Image } from 'react-native';

import {
  BUILTIN_THEME_ASSET_MODULES,
  BUILTIN_THEME_MANIFEST,
} from '@/theme/builtin-theme.generated';
import { registerBundledThemeAssets } from '@/theme/renderable-asset';
import { BUILTIN_THEME_INSTALLATION_ID, type InstalledTheme } from '@/theme/repository';
import { parseThemeManifest } from '@/theme/schema';

/**
 * The theme the app wears while the reader has none of their own.
 *
 * Its files are in the binary (`scripts/sync-builtin-theme.ts`), so this is a
 * lookup rather than an install: each asset id resolves to the URI Metro's
 * registry gives it on this platform. `Image.resolveAssetSource` rather than
 * `Asset.fromModule(...).uri`, for the reason `demoAssetContentUri` gives:
 * the latter produces an unloadable `file:///android_res/` path in an Android
 * release build.
 *
 * `null` when anything about it fails. The app then falls back to the code
 * pack it wore before there was a built-in theme -- the palette the starter
 * manifest is built from -- rather than to a half-loaded one.
 */
export function loadBuiltinTheme(): InstalledTheme | null {
  try {
    const manifest = parseThemeManifest(JSON.stringify(BUILTIN_THEME_MANIFEST));
    const assets: Record<string, string> = {};
    for (const id of Object.keys(manifest.assets ?? {})) {
      const uri = Image.resolveAssetSource(BUILTIN_THEME_ASSET_MODULES[id])?.uri;
      if (!uri) return null;
      assets[id] = uri;
    }
    registerBundledThemeAssets(Object.values(assets));
    return { id: BUILTIN_THEME_INSTALLATION_ID, manifest, assets };
  } catch {
    return null;
  }
}
