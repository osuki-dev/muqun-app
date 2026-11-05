import { Directory, File, FileMode, Paths } from 'expo-file-system';

import type { PickedFile } from './attachment-queue';
import { protectCacheDirectory } from './cache-cleanup';
import { assertStandaloneVideo } from './media-file';
import { planVideoCompression, VIDEO_MAX_EDGE } from './video-compression-plan';

type VideoCompressor = {
  compress(
    uri: string,
    options: { compressionMethod: 'auto'; maxSize: number; minimumFileSizeForCompress: number }
  ): Promise<string>;
};

/**
 * The native module ships with a native build, and an OTA bundle also runs on
 * builds that predate it: the module throws when it is imported and cannot
 * find its native half. That is "no compressor", not an error.
 */
function loadCompressor(): VideoCompressor | null {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- guarded: the native half may be missing from the installed build
    return (require('react-native-compressor') as { Video: VideoCompressor }).Video;
  } catch {
    return null;
  }
}

/**
 * Re-encode a picked video to H.264 at 1080p or below, with the bitrate the
 * module derives from the source.
 *
 * An optimisation, never a gate: with no native module, on any error, or when
 * the result is not smaller, the original is uploaded unchanged.
 */
/**
 * Where the compressed copy is kept. The module writes straight into the
 * cache root, where cleanup could take it mid-upload, so it is moved under a
 * leased folder of our own (`LEASED_CACHE_DIRECTORIES`).
 */
const OUTPUT_DIRECTORY = 'VideoCompressor';

export async function compressPickedVideo(
  file: PickedFile,
  compressor: VideoCompressor | null = loadCompressor()
): Promise<PickedFile> {
  if (!planVideoCompression(file) || !compressor) return file;
  try {
    await protectCacheDirectory(OUTPUT_DIRECTORY);
    // Refuse a playlist that only looks like a video before native code opens it.
    const handle = new File(file.uri).open(FileMode.ReadOnly);
    try {
      assertStandaloneVideo(file, await handle.readBytes(1024));
    } finally {
      handle.close();
    }
    const output = await compressor.compress(file.uri, {
      compressionMethod: 'auto',
      maxSize: VIDEO_MAX_EDGE,
      // Already filtered above; the module's own floor (in MB) must not skip it.
      minimumFileSizeForCompress: 0,
    });
    const produced = new File(output.startsWith('/') ? `file://${output}` : output);
    if (produced.uri === new File(file.uri).uri) return file;
    const smaller = produced.size > 0 && (file.size === undefined || produced.size < file.size);
    if (!smaller) {
      produced.delete();
      return file;
    }
    const directory = new Directory(Paths.cache, OUTPUT_DIRECTORY);
    directory.create({ idempotent: true, intermediates: true });
    const kept = new File(directory, `${produced.name}`);
    await produced.move(kept);
    return {
      uri: kept.uri,
      name: file.name.replace(/\.[a-z\d]{1,10}$/i, '') + '.mp4',
      mime: 'video/mp4',
      size: kept.size,
      width: file.width,
      height: file.height,
    };
  } catch (error) {
    console.warn('[attachments] video compression failed, uploading the original', error);
    return file;
  }
}
