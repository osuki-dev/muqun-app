import type { PickedFile } from './attachment-queue';
import { videoFileMime } from './media-file';

/** Videos below this are sent as they are: little to win, and a re-encode costs minutes of battery. */
export const VIDEO_COMPRESS_MIN_BYTES = 8 * 1024 * 1024;

/** The long edge of the re-encoded video: 1080p, whichever way the phone was held. */
export const VIDEO_MAX_EDGE = 1920;

/** Whether a picked file is a video worth re-encoding before upload. */
export function planVideoCompression(
  file: Pick<PickedFile, 'mime' | 'size' | 'name' | 'uri'>
): boolean {
  // `videoFileMime` refuses HLS/DASH manifests however they are labelled: the
  // native compressor would otherwise fetch what a playlist points at.
  return (
    videoFileMime(file) !== undefined &&
    (file.size === undefined || file.size >= VIDEO_COMPRESS_MIN_BYTES)
  );
}
