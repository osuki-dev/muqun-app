import type { PickedFile } from './attachment-queue';

/**
 * What a picked image is shrunk to before it is uploaded.
 *
 * A phone camera hands back a 4000-6000px frame, which is several megabytes on
 * a home uplink and, once it reaches the agent, several thousand tokens of
 * detail nobody asked for. 2048px on the long edge is still more than any
 * screen the result is read on, and is the point past which the extra pixels
 * only cost bytes.
 */
export const MAX_IMAGE_EDGE = 2048;

/** Lossy enough to matter on a photograph, not enough to see on one. */
export const COMPRESSED_IMAGE_QUALITY = 0.8;

/**
 * One output format for everything the agent is shown.
 *
 * WebP rather than JPEG because it is meaningfully smaller at the same quality,
 * and it is a real choice rather than an Android one: `expo-image-manipulator`
 * encodes WebP through `Bitmap.CompressFormat.WEBP` on Android and through
 * `SDImageWebPCoder` on iOS, so there is no platform split to keep track of.
 *
 * Not PNG. PNG is lossless, which is the wrong trade for a photograph: with no
 * perceptual redundancy to discard it comes out several times larger than the
 * JPEG it was decoded from, so "compressing" to PNG would send more bytes than
 * doing nothing. PNG only wins on flat-coloured screenshots.
 */
export const COMPRESSED_IMAGE_MIME = 'image/webp';

const COMPRESSED_IMAGE_EXTENSION = 'webp';

/**
 * How one picked image should be re-encoded. `resize` is absent when the image
 * is already small enough and only the format is being normalised; exactly one
 * edge is ever pinned, so the manipulator derives the other and the aspect
 * ratio survives.
 */
export interface ImageCompressionPlan {
  resize?: { width: number } | { height: number };
  quality: number;
  /** The name the compressed bytes are uploaded under, extension included. */
  name: string;
  mime: string;
}

/**
 * Animated formats are left alone: re-encoding one to a still frame silently
 * throws away the only interesting thing about it, and an animation small
 * enough to have been picked is not what is costing the uplink.
 */
const ANIMATED_MIMES = new Set(['image/gif', 'image/apng']);

function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Swap whatever extension the picker reported for the one the bytes will have. */
export function withCompressedExtension(name: string): string {
  const trimmed = name.trim() || 'image';
  const dot = trimmed.lastIndexOf('.');
  // A leading dot is the whole name of a hidden file rather than an extension,
  // and a dot in a directory-ish name is not one either.
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}.${COMPRESSED_IMAGE_EXTENSION}`;
}

/**
 * Decide what compressing one picked file should do, or `null` for "send it as
 * it is".
 *
 * This is separated from the manipulator call because the decision is the part
 * with rules in it -- which files are exempt, when a resize is worth doing, and
 * which edge to pin -- and it is worth testing without a native image codec
 * underneath.
 *
 * Dimensions come from the picker. When it does not report them the file is
 * still re-encoded, just without a resize: without knowing the orientation
 * there is no way to say which edge is the long one, and guessing wrong would
 * rotate a portrait photo's aspect ratio into a letterbox.
 */
export function planImageCompression(file: PickedFile): ImageCompressionPlan | null {
  if (!isImage(file.mime)) return null;
  if (ANIMATED_MIMES.has(file.mime)) return null;

  const width = normalizeEdge(file.width);
  const height = normalizeEdge(file.height);
  const oversized = width !== null && height !== null && Math.max(width, height) > MAX_IMAGE_EDGE;

  // Already the right format at a sane size: another lossy generation would
  // cost quality and save nothing.
  if (!oversized && file.mime === COMPRESSED_IMAGE_MIME) return null;

  return {
    ...(oversized ? { resize: resizeForLongEdge(width as number, height as number) } : {}),
    quality: COMPRESSED_IMAGE_QUALITY,
    name: withCompressedExtension(file.name),
    mime: COMPRESSED_IMAGE_MIME,
  };
}

function normalizeEdge(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Pin the longer edge and let the other one follow, so a portrait photo is not
 * quietly squared off. A square image is treated as landscape, which for equal
 * edges is the same answer either way.
 */
function resizeForLongEdge(width: number, height: number): { width: number } | { height: number } {
  return width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE };
}
