import { documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import appStorage from '../../modules/app-storage/src/MuqunAppStorageModule';
import type { AppStorageStats } from '../../modules/app-storage/src/MuqunAppStorage.types';

export type { AppStorageStats };

/** Android's own figures for this app; null on iOS and on builds without the module. */
export async function readAppStorageStats(): Promise<AppStorageStats | null> {
  try {
    if (typeof appStorage?.getStorageStats !== 'function') return null;
    return await appStorage.getStorageStats();
  } catch {
    return null;
  }
}

/**
 * Hot Updater's downloaded bundles, under the app's documents on both
 * platforms. Read-only here: the updater owns and prunes them.
 */
const UPDATE_DIRECTORIES = ['bundle-store', 'hot-updater-instances'];

export async function readAppUpdateBytes(): Promise<number> {
  const root = documentDirectory;
  if (!root) return 0;
  let bytes = 0;
  for (const name of UPDATE_DIRECTORIES) {
    try {
      const info = await getInfoAsync(root + name);
      if (info.exists && Number.isFinite(info.size)) bytes += info.size;
    } catch {
      // An unreadable directory counts as empty.
    }
  }
  return bytes;
}
