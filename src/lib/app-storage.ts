import { documentDirectory, getInfoAsync, readDirectoryAsync } from 'expo-file-system/legacy';
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

/** A missing or unreadable entry remains in Android's unclassified remainder. */
export async function readDataBreakdown(includeDocuments: boolean) {
  if (includeDocuments && appStorage?.getDataDirectorySizes) {
    const native = await appStorage.getDataDirectorySizes().catch(() => null);
    if (native) return native;
  }
  const root = documentDirectory;
  const groups: Record<string, number> = Object.create(null);
  if (!root) return groups;
  const names = includeDocuments
    ? await readDirectoryAsync(root).catch(() => UPDATE_DIRECTORIES)
    : UPDATE_DIRECTORIES;
  for (const name of names) {
    try {
      const info = await getInfoAsync(root + encodeURIComponent(name));
      if (!info.exists || !Number.isFinite(info.size) || info.size <= 0) continue;
      const group = UPDATE_DIRECTORIES.includes(name)
        ? 'updates'
        : info.isDirectory
          ? 'files/' + name
          : 'files';
      groups[group] = (groups[group] ?? 0) + info.size;
    } catch {
      // Files may be removed by their owner during measurement.
    }
  }
  return groups;
}
