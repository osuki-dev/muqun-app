import { Image } from 'expo-image';

/** Glide and SDWebImage own their storage; this only asks them to empty it. */
export const nativeImageCache = {
  clear: () => Image.clearDiskCache(),
};
