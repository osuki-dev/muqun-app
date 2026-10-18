import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { downloadOriginalImageRanges, type OriginalImageInfo } from './image-original-ranges';
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
  directory.create();
  const file = new File(directory, 'original.part');
  try {
    file.create();
  } catch (error) {
    directory.delete();
    throw error;
  }
  let handle: ReturnType<File['open']>;
  try {
    handle = file.open(FileMode.WriteOnly);
  } catch (error) {
    directory.delete();
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
      write(bytes) {
        if (handle.offset !== written) throw new Error('Invalid image file offset');
        handle.writeBytes(bytes);
        written += bytes.length;
        if (handle.offset !== written) throw new Error('Incomplete image file write');
      },
      finish(info) {
        close();
        if (written !== info.size || file.size !== info.size)
          throw new Error('Incomplete image file');
        const extension =
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
          )[info.mime] ?? 'img';
        file.rename(`original.${extension}`);
        return {
          uri: file.uri,
          cacheKey: file.uri,
          verifiedOriginal: { size: info.size, mime: info.mime },
          dispose: () => {
            try {
              if (directory.exists) directory.delete();
            } catch {
              console.warn('[image-preview] Temporary image cleanup deferred to startup');
            }
          },
        };
      },
      abort() {
        try {
          close();
        } finally {
          if (directory.exists) directory.delete();
        }
      },
    },
  });
}
