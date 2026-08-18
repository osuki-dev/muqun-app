// The global instance and inert `msg` descriptors, not a hook: every sentence
// below is written at failure time inside an event handler, never in a render,
// so the locale is read when the error actually happens.
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { MAX_ATTACHMENTS_PER_PICK, type PickedFile } from './attachment-queue';
import { planImageCompression } from './image-compression';
import { describeGatewayFailure } from './network-error';
import { pickedFilesFromDocuments } from './picked-files';

// The strip's vocabulary lives with the queue that governs it, which is a
// module the native pickers do not reach into and so can be tested on its own.
// It is re-exported here because picking is where callers meet these types.
export {
  isImageAttachment,
  MAX_ATTACHMENTS_PER_PICK,
  MAX_UPLOAD_BYTES,
  nextAttachmentId,
  type AttachmentUploadStatus,
  type PendingAttachment,
  type PickedFile,
} from './attachment-queue';
export {
  COMPRESSED_IMAGE_MIME,
  MAX_IMAGE_EDGE,
  planImageCompression,
} from './image-compression';

/** Where a file the user wants to send came from. */
export type AttachmentSource = 'camera' | 'library' | 'file';

/**
 * A picker problem the user can act on -- a denied permission, or hardware the
 * device does not have. Carries its own copy so the caller can toast it as-is.
 */
export class AttachmentPickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentPickerError';
  }
}

const IMAGE_EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
};

function extensionOf(uriOrName: string): string {
  const withoutQuery = uriOrName.split(/[?#]/)[0] ?? '';
  const match = withoutQuery.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function fileNameFromUri(uri: string, fallbackExtension: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  if (last.includes('.')) return decodeURIComponent(last);
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return `${stamp}.${fallbackExtension}`;
}

/**
 * The pickers do not always know the type: the media library can return an
 * asset with no `mimeType`, and a document provider can hand back
 * `application/octet-stream` for a plain photo. The extension is the tiebreak.
 */
function resolveMime(reported: string | null | undefined, name: string, uri: string): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const extension = extensionOf(name) || extensionOf(uri);
  return IMAGE_EXTENSION_MIMES[extension] ?? reported ?? 'application/octet-stream';
}

function toPickedFiles(assets: ImagePicker.ImagePickerAsset[]): PickedFile[] {
  return assets.map((asset) => {
    const name = asset.fileName ?? fileNameFromUri(asset.uri, asset.type === 'video' ? 'mp4' : 'jpg');
    return {
      uri: asset.uri,
      name,
      mime: resolveMime(asset.mimeType, name, asset.uri),
      size: asset.fileSize ?? undefined,
      width: asset.width,
      height: asset.height,
    };
  });
}

/**
 * Shrink one picked image to what is worth uploading: at most 2048px on the
 * long edge, re-encoded to a single format so everything the agent is handed
 * arrives the same way.
 *
 * Never throws and never returns nothing. A codec that cannot read the file, a
 * format the device will not encode, a temporary directory that is full --
 * whatever goes wrong, the original file is answered and the upload proceeds at
 * full size. Making a smaller upload is worth doing; it is not worth failing a
 * user's photo over, so this stays an optimisation rather than a gate.
 *
 * The re-encode is also what keeps EXIF off the wire: the manipulator writes
 * from decoded pixels, so there is no metadata left to strip.
 */
export async function compressPickedImage(file: PickedFile): Promise<PickedFile> {
  const plan = planImageCompression(file);
  if (!plan) return file;

  const context = ImageManipulator.manipulate(file.uri);
  try {
    if (plan.resize) context.resize(plan.resize);
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: plan.quality });
      return {
        uri: saved.uri,
        name: plan.name,
        mime: plan.mime,
        // The manipulator reports no byte count, and the only reader of `size`
        // is the pre-upload limit check, which has already run against the
        // original -- a smaller file cannot newly fail it.
        size: undefined,
        width: saved.width,
        height: saved.height,
      };
    } finally {
      // A decoded camera frame is tens of megabytes of bitmap. Nine of them
      // waiting on the collector is how a pick turns into an OOM, so both
      // native handles are dropped as soon as the bytes are on disk.
      rendered.release();
    }
  } catch (error) {
    console.warn('[attachments] compression failed, uploading the original', error);
    return file;
  } finally {
    context.release();
  }
}

/**
 * Take one photo. Answers an empty list when the user backs out, so a cancel is
 * never reported as a failure.
 */
export async function pickCameraPhoto(): Promise<PickedFile[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new AttachmentPickerError(i18n._(msg`Camera access is off. Turn it on in Settings to take a photo.`));
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    exif: false,
  });
  if (result.canceled) return [];
  return toPickedFiles(result.assets);
}

export async function pickPhotoLibrary(): Promise<PickedFile[]> {
  // No permission request: both platforms now answer through a system picker
  // that hands back only what was chosen, so asking for library access would be
  // a prompt for an authorisation the app does not need.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_ATTACHMENTS_PER_PICK,
    quality: 0.85,
    exif: false,
  });
  if (result.canceled) return [];
  return toPickedFiles(result.assets).slice(0, MAX_ATTACHMENTS_PER_PICK);
}

/**
 * Choose ordinary documents through the platform picker. Copying to cache is
 * intentional: Android providers commonly return a content URI, while the
 * multipart uploader needs a URI it can read immediately after this promise.
 */
export async function pickFiles(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: true,
    // Avoid turning a large web attachment into a second in-memory base64 copy.
    base64: false,
  });
  if (result.canceled) return [];
  return pickedFilesFromDocuments(result.assets).slice(0, MAX_ATTACHMENTS_PER_PICK);
}

export function pickAttachments(source: AttachmentSource): Promise<PickedFile[]> {
  if (source === 'camera') return pickCameraPhoto();
  if (source === 'library') return pickPhotoLibrary();
  return pickFiles();
}

/**
 * Turn a failed pick into something worth showing. Anything that is not an
 * actionable problem -- most often "there is no camera here", which is what a
 * simulator reports -- still gets a plain sentence rather than a native trace.
 */
export function describePickerFailure(source: AttachmentSource, error: unknown): string {
  if (error instanceof AttachmentPickerError) return error.message;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (source === 'camera' && /camera|unavailable|not available|simulator/i.test(raw)) {
    return i18n._(msg`This device has no camera available.`);
  }
  return raw || i18n._(msg`Could not open the picker.`);
}

/**
 * The gateway rejects an upload for two reasons the user can do something
 * about; everything else falls through to the shared network wording.
 */
export function describeUploadFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const status = Number(raw.match(/^HTTP (\d+):/)?.[1] ?? 0);
  if (status === 413) return i18n._(msg`File too large (25MB max)`);
  if (status === 415) return i18n._(msg`File type not allowed`);
  return describeGatewayFailure(error, i18n._(msg`Could not upload the file.`)).message;
}
