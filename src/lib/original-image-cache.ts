import {
  copyAsync,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  readDirectoryAsync,
  cacheDirectory,
} from 'expo-file-system/legacy';
import { createCacheMutationQueue } from './cache-cleanup-policy';
import { ORIGINAL_IMAGE_CACHE_DIRECTORY, planLruTrim } from './cache-storage';

/** The whole folder never holds more than this; the oldest files go first. */
export const ORIGINAL_IMAGE_CACHE_BYTES = 48 * 1024 * 1024;
/** A larger original would push out most of the folder for one image. */
export const ORIGINAL_IMAGE_SEED_LIMIT = 16 * 1024 * 1024;

const mutations = createCacheMutationQueue();

function directoryUri(): string | null {
  return cacheDirectory ? `${cacheDirectory}${ORIGINAL_IMAGE_CACHE_DIRECTORY}/` : null;
}

/** Keys are SHA-256 hex digests; anything else is refused before it names a path. */
function fileUri(key: string): string | null {
  const directory = directoryUri();
  return directory && /^[0-9a-f]{64}$/.test(key) ? directory + key : null;
}

async function trim(directory: string): Promise<void> {
  const files = [];
  for (const name of await readDirectoryAsync(directory)) {
    const info = await getInfoAsync(directory + name);
    if (!info.exists || info.isDirectory) continue;
    files.push({ name, bytes: info.size, modifiedAtMs: info.modificationTime * 1000 });
  }
  for (const name of planLruTrim(files, ORIGINAL_IMAGE_CACHE_BYTES)) {
    await deleteAsync(directory + name, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * Verified full-size originals, kept so reopening an image skips the ranged
 * download. A folder of its own rather than the shared image cache: originals
 * are up to 16 MB each, and in Glide they pushed out the thumbnails the lists
 * actually show.
 */
export const originalImageCache = {
  epoch: mutations.epoch,
  invalidate: mutations.invalidate,
  async path(key: string): Promise<string | null> {
    const uri = fileUri(key);
    if (!uri) return null;
    const info = await getInfoAsync(uri);
    return info.exists && !info.isDirectory ? uri : null;
  },
  seed: (uri: string, key: string, epoch: number) =>
    mutations.write(epoch, async () => {
      const directory = directoryUri();
      const target = fileUri(key);
      if (!directory || !target) return;
      await makeDirectoryAsync(directory, { intermediates: true });
      // Copy beside the target and move into place, so a reader never sees half a file.
      const partial = `${target}.part`;
      await copyAsync({ from: uri, to: partial });
      await deleteAsync(target, { idempotent: true });
      await moveAsync({ from: partial, to: target });
      await trim(directory);
    }),
  clear: () =>
    mutations.clear(async () => {
      const directory = directoryUri();
      if (!directory) return true;
      await deleteAsync(directory, { idempotent: true });
      return true;
    }),
};
