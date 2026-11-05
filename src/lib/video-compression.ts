import { File } from 'expo-file-system';

import type { PickedFile } from './attachment-queue';
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
export async function compressPickedVideo(
  file: PickedFile,
  compressor: VideoCompressor | null = loadCompressor()
): Promise<PickedFile> {
  if (!planVideoCompression(file) || !compressor) return file;
  try {
    const output = await compressor.compress(file.uri, {
      compressionMethod: 'auto',
      maxSize: VIDEO_MAX_EDGE,
      // Already filtered above; the module's own floor (in MB) must not skip it.
      minimumFileSizeForCompress: 0,
    });
    const uri = output.startsWith('/') ? `file://${output}` : output;
    const size = new File(uri).size;
    if (!(size > 0) || (file.size !== undefined && size >= file.size)) return file;
    return {
      uri,
      name: file.name.replace(/\.[a-z\d]{1,10}$/i, '') + '.mp4',
      mime: 'video/mp4',
      size,
      width: file.width,
      height: file.height,
    };
  } catch (error) {
    console.warn('[attachments] video compression failed, uploading the original', error);
    return file;
  }
}
