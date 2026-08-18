/**
 * More than this in one go is a mis-tap rather than an intent, and every pick
 * starts its own upload against a gateway that is usually on a home network.
 */
export const MAX_ATTACHMENTS_PER_PICK = 9;

/**
 * The app's own ceiling, deliberately below the gateway's 25MB body limit.
 *
 * The encrypted transport seals an upload as one envelope -- multipart, then
 * base64, then ciphertext, then base64 again -- so the wire body is ~1.78x
 * the file, and the gateway's transport buffer (25MB + 128KB) turns that into
 * a hard cliff at about 14MB: measured, a 13MB file uploads and a 15MB file
 * dies as a bare `invalid_envelope`. 10MB keeps a wide margin under that
 * cliff, and keeps the phone's several in-memory copies of the file (raw,
 * base64, ciphertext, envelope JSON) inside what a mid-range device absorbs
 * without a hiccup.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Enough to keep a home network busy without a nine-photo pick opening nine
 * sockets against a gateway that is usually somebody's laptop.
 */
export const MAX_CONCURRENT_UPLOADS = 3;

const TOO_LARGE_MESSAGE = 'File too large (10MB max)';

/** A file chosen on the device, before it has been sent anywhere. */
export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  /** Not every picker reports one; absence skips the client-side size check. */
  size?: number;
  /**
   * Pixel dimensions as the picker reported them. They decide whether the file
   * is worth resizing before upload, and absence only costs the resize.
   */
  width?: number;
  height?: number;
}

/**
 * `pending` is queued rather than merely chosen: the file has been picked and
 * its upload has not started yet, which is only ever a wait for a free slot.
 */
export type AttachmentUploadStatus = 'pending' | 'uploading' | 'done' | 'error';

/**
 * One entry in the composer's attachment strip. `remotePath` is set once the
 * gateway has the file and is what actually gets sent with the message.
 */
export interface PendingAttachment {
  id: string;
  localUri: string;
  name: string;
  mime: string;
  size?: number;
  width?: number;
  height?: number;
  status: AttachmentUploadStatus;
  remotePath?: string;
  error?: string;
}

let attachmentCounter = 0;

/** Ids only need to be unique within one composer, not across sessions. */
export function nextAttachmentId(): string {
  attachmentCounter += 1;
  return `attachment-${Date.now().toString(36)}-${attachmentCounter}`;
}

export function isImageAttachment(mime: string): boolean {
  return mime.startsWith('image/');
}

/**
 * The composer's upload queue, as plain transitions over a list.
 *
 * Uploading starts when a file is picked rather than when the message is sent,
 * so by the time Send is tapped the paths usually already exist and the message
 * can go out at once. That only works if every entry carries its own state:
 * one photo failing has to leave the other eight alone, and a retry has to be
 * something the user can aim at a single tile.
 *
 * These are pure functions over the list because the ordering rules -- which
 * entry may start, when the queue counts as settled, whether the set of paths
 * is complete -- are the part worth testing, and they are much easier to test
 * without a running React tree around them.
 */

/**
 * Add picks to the queue as `pending`, which means queued rather than merely
 * chosen: the pump starts them immediately afterwards.
 *
 * A known-oversized pick is failed here, before any socket is opened, so the
 * user learns at selection instead of after streaming the file into a refusal.
 */
export function stageFiles(queue: PendingAttachment[], files: PickedFile[]): PendingAttachment[] {
  if (files.length === 0) return queue;
  return [
    ...queue,
    ...files.map((file) => {
      const tooLarge = file.size !== undefined && file.size > MAX_UPLOAD_BYTES;
      return {
        id: nextAttachmentId(),
        localUri: file.uri,
        name: file.name,
        mime: file.mime,
        size: file.size,
        width: file.width,
        height: file.height,
        status: tooLarge ? ('error' as const) : ('pending' as const),
        error: tooLarge ? TOO_LARGE_MESSAGE : undefined,
      };
    }),
  ];
}

/**
 * The entries that may begin uploading now: queued ones, in the order they were
 * picked, up to whatever the concurrency limit leaves free. Counting what is
 * already in flight here rather than at the call site is what keeps a retry
 * tapped during a busy queue from opening a fourth socket.
 */
export function startableIds(
  queue: PendingAttachment[],
  maxConcurrent: number = MAX_CONCURRENT_UPLOADS
): string[] {
  const inFlight = queue.filter((entry) => entry.status === 'uploading').length;
  const free = maxConcurrent - inFlight;
  if (free <= 0) return [];
  const ids: string[] = [];
  for (const entry of queue) {
    if (ids.length === free) break;
    if (entry.status === 'pending') ids.push(entry.id);
  }
  return ids;
}

// Patching by id rather than by position means an entry removed mid-upload is
// simply not found, and its result is dropped instead of resurrecting it.
function patch(
  queue: PendingAttachment[],
  id: string,
  changes: Partial<PendingAttachment>
): PendingAttachment[] {
  return queue.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry));
}

export function markUploading(queue: PendingAttachment[], id: string): PendingAttachment[] {
  return patch(queue, id, { status: 'uploading', error: undefined });
}

/**
 * The gateway renames what it stores, so the uploaded name replaces the local
 * one when it has something to say; `remotePath` is what the message carries.
 */
export function markUploaded(
  queue: PendingAttachment[],
  id: string,
  uploaded: { path: string; name?: string }
): PendingAttachment[] {
  const entry = queue.find((item) => item.id === id);
  if (!entry) return queue;
  return patch(queue, id, {
    status: 'done',
    remotePath: uploaded.path,
    name: uploaded.name || entry.name,
    error: undefined,
  });
}

export function markFailed(
  queue: PendingAttachment[],
  id: string,
  message: string
): PendingAttachment[] {
  return patch(queue, id, { status: 'error', error: message });
}

/**
 * Put a failed entry back in the queue. An oversized file is refused again
 * without a round trip, because nothing about it has changed; anything else is
 * worth another go, since most upload failures here are a phone that wandered
 * off the network for a moment.
 */
export function requeue(queue: PendingAttachment[], id: string): PendingAttachment[] {
  const entry = queue.find((item) => item.id === id);
  if (!entry || entry.status === 'uploading' || entry.status === 'done') return queue;
  if (entry.size !== undefined && entry.size > MAX_UPLOAD_BYTES) {
    return patch(queue, id, { status: 'error', error: TOO_LARGE_MESSAGE });
  }
  return patch(queue, id, { status: 'pending', error: undefined });
}

export function removeEntry(queue: PendingAttachment[], id: string): PendingAttachment[] {
  return queue.filter((entry) => entry.id !== id);
}

/** Still queued or in flight, which is what Send has to wait out. */
export function isBusy(queue: PendingAttachment[]): boolean {
  return queue.some((entry) => entry.status === 'pending' || entry.status === 'uploading');
}

export function hasFailures(queue: PendingAttachment[]): boolean {
  return queue.some((entry) => entry.status === 'error');
}

/**
 * Every uploaded path in strip order, which is the order they were picked in,
 * so the paths in the message match the tiles the user is looking at.
 *
 * `null` when anything failed: a message that quietly dropped one of four
 * photos is worse than one that was not sent, so the caller stops and says so.
 */
export function uploadedPaths(queue: PendingAttachment[]): string[] | null {
  if (hasFailures(queue)) return null;
  const paths: string[] = [];
  for (const entry of queue) {
    if (entry.status === 'done' && entry.remotePath) paths.push(entry.remotePath);
  }
  return paths;
}
