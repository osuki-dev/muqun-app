import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { protectCacheDirectory, releaseCacheDirectory } from '@/lib/cache-cleanup';
import { prepareThemeAssets, type PreparedThemeAssets } from './assets';
import type { PickedThemeArtwork } from './artwork-selection';
import { THEME_LIMITS } from './schema';
import { createThemeStarter } from './starter';

/** The system picker grants access to one image; only a verified private copy survives. */
export async function pickThemeArtwork(): Promise<PickedThemeArtwork | null> {
  await protectCacheDirectory('ImagePicker');
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: false,
      quality: 1,
      exif: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return null;
    const selected = result.assets[0];
    if (!selected) return null;
    const file = new File(selected.uri);
    let prepared: PreparedThemeAssets | undefined;
    try {
      if (
        !file.exists ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > THEME_LIMITS.assetBytes ||
        !Number.isSafeInteger(selected.width) ||
        !Number.isSafeInteger(selected.height) ||
        selected.width <= 0 ||
        selected.height <= 0 ||
        selected.width * selected.height > THEME_LIMITS.imagePixels
      )
        throw new Error('Theme image exceeds the size or pixel limit');
      const manifest = createThemeStarter();
      manifest.assets = { picked: { path: 'assets/picked.png' } };
      prepared = await prepareThemeAssets({ manifest, assets: { picked: await file.bytes() } });
      const assets = await prepared.install();
      return { uri: assets.picked!, dispose: prepared.dispose };
    } catch (error) {
      prepared?.dispose();
      throw error;
    } finally {
      // Only the picker's cache copy, never the photo library or a selected original.
      const cache = new Directory(Paths.cache, 'ImagePicker').uri.replace(/\/$/, '') + '/';
      if (file.uri.startsWith(cache)) {
        try {
          if (file.exists) file.delete();
        } catch {
          /* OS cache eviction can retry. */
        }
      }
    }
  } finally {
    releaseCacheDirectory('ImagePicker');
  }
}
