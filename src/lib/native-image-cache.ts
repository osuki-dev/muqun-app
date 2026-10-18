import { Image } from 'expo-image';
import { createCacheMutationQueue } from './cache-cleanup-policy';

const mutations = createCacheMutationQueue();

/** Storage and eviction belong to Expo Image, not a second application cache. */
export const nativeImageCache = {
  epoch: mutations.epoch,
  invalidate: mutations.invalidate,
  path: (key: string) => Image.getCachePathAsync(key),
  seed: (uri: string, key: string, epoch: number) =>
    mutations.write(epoch, () => Image.writeToCacheAsync(uri, key)),
  clear: () => mutations.clear(() => Image.clearDiskCache()),
};
