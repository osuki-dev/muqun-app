import { protectTemporaryCacheEntry } from './cache-cleanup';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import {
  downloadOriginalImageRanges,
  writeOriginalImageChunk,
  type OriginalImageInfo,
} from './image-original-ranges';
import type { PreviewImageSource } from './gateway-image-previews';

/** The only large-image path: incremental writes to one private owned file. */
export async function downloadOriginalImageFile(options: {
  request: (headers: Record<string, string>, signal: AbortSignal) => Promise<Response>;
  signal?: AbortSignal;
  size?: number;
  assertCurrent?: () => void;
  acquireVersion?: (signal: AbortSignal) => Promise<OriginalImageInfo>;
}): Promise<PreviewImageSource> {
  // Existing startup/clear-cache ownership recognizes timestamped file-export dirs.
  const directory = new Directory(
    Paths.cache,
    `file-export-${Date.now()}-${Math.floor(Math.random() * 2 ** 32)}`
  );
  const disposeCache = await protectTemporaryCacheEntry(directory);
  const file = new File(directory, 'original.part');
  try {
    directory.create();
    file.create();
  } catch (error) {
    disposeCache();
    throw error;
  }
  let handle: ReturnType<File['open']>;
  try {
    handle = file.open(FileMode.WriteOnly);
  } catch (error) {
    disposeCache();
    throw error;
  }
  let closed = false;
  let written = 0;
  const close = () => {
    if (!closed) {
      closed = true;
      handle.close();
    }
  };
  return downloadOriginalImageRanges({
    ...options,
    sink: {
      async write(bytes) {
        written = await writeOriginalImageChunk(handle, bytes, written);
      },
      finish(info) {
        close();
        if (written !== info.size || file.size !== info.size)
          throw new Error('Incomplete image file');

        file.rename(`original.${originalImageExtension(info.mime)}`);
        return {
          uri: file.uri,
          cacheKey: file.uri,
          verifiedOriginal: { size: info.size, mime: info.mime },
          dispose: disposeCache,
        };
      },
      abort() {
        try {
          close();
        } finally {
          disposeCache();
        }
      },
    },
  });
}

function originalImageExtension(mime: string): string {
  return (
    (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/heic': 'heic',
        'image/avif': 'avif',
        'image/svg+xml': 'svg',
      } as Record<string, string>
    )[mime] ?? 'img'
  );
}

/** A per-view/export copy survives native cache eviction; no second cache is retained. */
export async function copyCachedOriginalImageFile(
  cachedPath: string,
  info: OriginalImageInfo
): Promise<PreviewImageSource> {
  const directory = new Directory(
    Paths.cache,
    `file-export-${Date.now()}-${Math.floor(Math.random() * 2 ** 32)}`
  );
  const disposeCache = await protectTemporaryCacheEntry(directory);
  const file = new File(directory, `original.${originalImageExtension(info.mime)}`);
  try {
    directory.create();
    const source = new File(cachedPath.startsWith('file:') ? cachedPath : `file://${cachedPath}`);
    if (source.size !== info.size) throw new Error('Invalid cached original size');
    await copyAsync({ from: source.uri, to: file.uri });
    if (file.size !== info.size) throw new Error('Incomplete cached original copy');
    return {
      uri: file.uri,
      cacheKey: file.uri,
      verifiedOriginal: { size: info.size, mime: info.mime },
      dispose: disposeCache,
    };
  } catch (error) {
    disposeCache();
    throw error;
  }
}
