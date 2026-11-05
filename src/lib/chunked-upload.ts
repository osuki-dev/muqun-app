/**
 * The chunk loop of the Gateway's chunked upload (`POST /api/uploads/chunked`).
 *
 * Transport and file access are injected so the loop is the only thing under
 * test: chunks go out in order, a failed chunk is retried (resending the last
 * chunk with the same bytes is idempotent on the Gateway), and a cancelled or
 * failed upload is aborted so the Gateway can drop its partial file.
 */
export interface ChunkedUploadTransport<Result> {
  begin(): Promise<{ uploadId: string; chunkBytes: number }>;
  put(uploadId: string, index: number, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  complete(uploadId: string): Promise<Result>;
  abort(uploadId: string): Promise<void>;
}

/** Attempts per chunk, the first included. */
export const CHUNK_ATTEMPTS = 3;

/** Statuses a retry cannot change: the Gateway has judged the upload itself. */
function isFinalRefusal(error: unknown): boolean {
  const status = Number((error instanceof Error ? error.message : '').match(/^HTTP (\d+):/)?.[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 409;
}

export async function runChunkedUpload<Result>(options: {
  transport: ChunkedUploadTransport<Result>;
  /** Read the next `length` bytes of the file, in order. Shorter only at the end. */
  readChunk: (length: number) => Promise<Uint8Array<ArrayBuffer>>;
  size: number;
  isCurrent: () => boolean;
  onProgress?: (sent: number, total: number) => void;
  retryDelayMs?: number;
}): Promise<Result> {
  const { transport, size, isCurrent } = options;
  const { uploadId, chunkBytes } = await transport.begin();
  const cancelled = () => new Error('Upload cancelled.');
  try {
    let sent = 0;
    for (let index = 0; sent < size; index += 1) {
      if (!isCurrent()) throw cancelled();
      const bytes = await options.readChunk(Math.min(chunkBytes, size - sent));
      if (bytes.length === 0) throw new Error('The file ended before its reported size.');
      for (let attempt = 1; ; attempt += 1) {
        try {
          await transport.put(uploadId, index, bytes);
          break;
        } catch (error) {
          if (attempt >= CHUNK_ATTEMPTS || isFinalRefusal(error) || !isCurrent()) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, (options.retryDelayMs ?? 500) * attempt)
          );
        }
      }
      sent += bytes.length;
      options.onProgress?.(sent, size);
    }
    if (!isCurrent()) throw cancelled();
    return await transport.complete(uploadId);
  } catch (error) {
    await transport.abort(uploadId).catch(() => {});
    throw error;
  }
}
