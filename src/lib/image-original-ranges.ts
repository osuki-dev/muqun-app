import { sealedBodyEncoding, type SealedResponseEncoding } from './envelope-encoding';
import { answerHasNoBody, startRequestBudget } from './request-budget';
import { parseOriginalImageVersion, type OriginalImageVersion } from './gateway-image-previews';

/** Standard HTTP ranges only; each authenticated/decrypted response stays small. */
export const IMAGE_RANGE_BYTES = 1024 * 1024;
export const MAX_ORIGINAL_IMAGE_BYTES = 256 * 1024 * 1024;
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
export const IMAGE_VERSION_BYTES = 64 * 1024;

export async function readOriginalImageVersion(
  response: Response,
  assetId: string,
  signal?: AbortSignal
): Promise<OriginalImageVersion> {
  try {
    if (response.status !== 200)
      throw new Error(`Image version request failed: HTTP ${response.status}`);
    const bytes = await readLimitedImageBody(response, IMAGE_VERSION_BYTES, signal);
    return parseOriginalImageVersion(JSON.parse(new TextDecoder().decode(bytes)), assetId);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

/** Image-only streaming adapter using an existing host fetch implementation. */
export async function fetchBoundedImageResponse(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  idleTimeoutMs = 60_000
): Promise<Response> {
  const budget = startRequestBudget(timeoutMs, 'Timed out reading the image.', init.signal);
  const transport = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectIdle: (error: Error) => void = () => {};
  const idleDeadline = new Promise<never>((_, reject) => {
    rejectIdle = reject;
  });
  idleDeadline.catch(() => {});
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      transport.abort();
      rejectIdle(new Error('Timed out waiting for image data.'));
    }, idleTimeoutMs);
  };
  const abort = () => {
    transport.abort();
    if (init.signal?.aborted) rejectIdle(new Error('Image download cancelled'));
  };
  budget.signal.addEventListener('abort', abort, { once: true });
  if (budget.signal.aborted) abort();
  const release = () => {
    clearTimeout(idleTimer);
    budget.disarm();
    budget.signal.removeEventListener('abort', abort);
  };
  resetIdle();
  try {
    const response = await Promise.race([
      fetcher(url, { ...init, signal: transport.signal, redirect: 'error' }),
      budget.deadline,
      idleDeadline,
    ]);
    if (answerHasNoBody(init.method, response.status) || !response.body) {
      release();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await Promise.race([reader.read(), budget.deadline, idleDeadline]);
            if (next.done) {
              release();
              controller.close();
            } else {
              if (next.value.byteLength > 0) resetIdle();
              controller.enqueue(next.value);
            }
          } catch (error) {
            transport.abort();
            release();
            await reader.cancel().catch(() => undefined);
            controller.error(error);
          }
        },
        async cancel() {
          // Expo cancelStreaming is a no-op before streaming starts; abort native I/O too.
          transport.abort();
          release();
          await reader.cancel().catch(() => undefined);
        },
      },
      { highWaterMark: 0 }
    );
    return new Proxy(response, {
      get(target, property) {
        if (property === 'body') return body;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  } catch (error) {
    transport.abort();
    release();
    throw error;
  }
}

export function assertImageEnvelopeLimit(
  payload: SealedResponseEncoding & { body: string },
  limit: number
): void {
  const encoding = sealedBodyEncoding(payload);
  if (
    (encoding !== null && encoding !== 'identity') ||
    payload.body.length > Math.ceil(limit / 3) * 4
  )
    throw new Error('Encrypted image response exceeds the read limit');
}

export function verifiedOriginalImageFile(
  uri: string,
  cacheUri: string,
  actualSize: number,
  info: { size: number; mime: string } | undefined
): boolean {
  const prefix = `${cacheUri.replace(/\/$/, '')}/file-export-`;
  return Boolean(
    info &&
    uri.startsWith(prefix) &&
    /^[0-9]+-[0-9]+\/original\.[a-z0-9]+$/.test(uri.slice(prefix.length)) &&
    Number.isSafeInteger(actualSize) &&
    actualSize > 0 &&
    actualSize <= MAX_ORIGINAL_IMAGE_BYTES &&
    actualSize === info.size &&
    /^image\/[a-z0-9.+-]+$/.test(info.mime)
  );
}

export interface OriginalImageInfo {
  size: number;
  mime: string;
  etag: string | null;
}

export interface ImageRangeSink<T> {
  write(bytes: Uint8Array): void | Promise<void>;
  finish(info: OriginalImageInfo): T | Promise<T>;
  abort(): void | Promise<void>;
}

/** SDK 58 writes asynchronously; do not inspect the advanced offset or close early. */
export async function writeOriginalImageChunk(
  handle: { offset: number | null; writeBytes: (bytes: Uint8Array) => Promise<void> },
  bytes: Uint8Array,
  written: number
): Promise<number> {
  if (handle.offset !== written) throw new Error('Invalid image file offset');
  await handle.writeBytes(bytes);
  const next = written + bytes.length;
  if (handle.offset !== next) throw new Error('Incomplete image file write');
  return next;
}

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Image download cancelled');
}

/** Reject oversized/unknown responses before reading them; never call arrayBuffer. */
export async function readLimitedImageBody(
  response: Response,
  limit: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Image response exceeds the read limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Bounded image response streaming is unavailable');
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  const bytes = new Uint8Array(limit);
  let count = 0;
  try {
    for (;;) {
      cancelled(signal);
      const part = await reader.read();
      cancelled(signal);
      if (part.done) break;
      if (part.value.length > limit - count)
        throw new Error('Image response exceeds the read limit');
      bytes.set(part.value, count);
      count += part.value.length;
    }
    if (declared !== null && count !== Number(declared))
      throw new Error('Incomplete image response');
    return bytes.subarray(0, count);
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
  }
}

function contentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total) &&
    start >= 0 &&
    end >= start &&
    total > end
    ? { start, end, total }
    : null;
}

function validator(value: string | null): string | null {
  return value && /^(?:W\/)?"[^"\r\n]{1,256}"$/.test(value) ? value : null;
}

/** No automatic restart: a changed source fails and deletes the partial file. */
export async function downloadOriginalImageRanges<T>(options: {
  request: (headers: Record<string, string>, signal: AbortSignal) => Promise<Response>;
  sink: ImageRangeSink<T>;
  signal?: AbortSignal;
  size?: number;
  assertCurrent?: () => void;
  acquireVersion?: (signal: AbortSignal) => Promise<OriginalImageInfo>;
}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, IMAGE_DOWNLOAD_TIMEOUT_MS);
  let offset = 0;
  let total: number | null = null;
  let etag: string | null = null;
  let mime: string | null = null;
  try {
    cancelled(controller.signal);
    options.assertCurrent?.();
    const fixed = await options.acquireVersion?.(controller.signal);
    if (
      fixed &&
      (!fixed.etag ||
        !/^"sha256-[a-f0-9]{64}"$/.test(fixed.etag) ||
        !Number.isSafeInteger(fixed.size) ||
        fixed.size <= 0 ||
        fixed.size > MAX_ORIGINAL_IMAGE_BYTES ||
        !/^image\/[a-z0-9.+-]+$/.test(fixed.mime))
    )
      throw new Error('Invalid fixed original image version');
    if (
      !fixed &&
      options.size !== undefined &&
      (!Number.isSafeInteger(options.size) ||
        options.size <= 0 ||
        options.size > MAX_ORIGINAL_IMAGE_BYTES)
    )
      throw new Error('Image exceeds the original download limit');
    const maxRequests = Math.ceil(MAX_ORIGINAL_IMAGE_BYTES / IMAGE_RANGE_BYTES);
    for (let attempt = 0; attempt < maxRequests; attempt++) {
      cancelled(controller.signal);
      options.assertCurrent?.();
      const end = Math.min(offset + IMAGE_RANGE_BYTES - 1, (total ?? MAX_ORIGINAL_IMAGE_BYTES) - 1);
      const headers: Record<string, string> = { Range: `bytes=${offset}-${end}` };
      // R4 pins the version before part zero. Never send If-Range or reacquire mid-file.
      if (fixed?.etag) headers['If-Match'] = fixed.etag;
      const response = await options.request(headers, controller.signal);
      let bodyRead = false;
      try {
        cancelled(controller.signal);
        if (fixed && response.status !== 206)
          throw new Error(`Image range request failed: HTTP ${response.status}`);
        const currentMime =
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
        if (!/^image\/[a-z0-9.+-]+$/.test(currentMime))
          throw new Error('Gateway did not return an image');
        if (mime !== null && mime !== currentMime) throw new Error('Image changed during download');
        const currentEtag = validator(response.headers.get('etag'));
        if (fixed && (currentEtag !== fixed.etag || currentMime !== fixed.mime))
          throw new Error('Image changed during download');
        let expected: number;
        if (response.status === 206) {
          const range = contentRange(response.headers.get('content-range'));
          if (
            !range ||
            range.start !== offset ||
            range.end !== Math.min(end, range.total - 1) ||
            range.total > MAX_ORIGINAL_IMAGE_BYTES
          )
            throw new Error('Invalid image Content-Range');
          if (total !== null && total !== range.total)
            throw new Error('Image changed during download');
          if (offset > 0 && currentEtag !== etag) throw new Error('Image changed during download');
          if (range.total > IMAGE_RANGE_BYTES && !fixed)
            throw new Error('Original image version is not safe for ranged download');
          total = range.total;
          expected = range.end - range.start + 1;
        } else if (response.status === 200 && offset === 0 && !fixed) {
          const length = response.headers.get('content-length');
          if (
            !length ||
            !/^\d+$/.test(length) ||
            Number(length) <= 0 ||
            Number(length) > IMAGE_RANGE_BYTES
          )
            throw new Error('Gateway ignored bounded image Range');
          total = Number(length);
          expected = total;
        } else {
          throw new Error(`Image range request failed: HTTP ${response.status}`);
        }
        if (fixed ? total !== fixed.size : options.size !== undefined && total !== options.size)
          throw new Error('Image changed during download');
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) !== expected)
          throw new Error('Invalid image range length');
        bodyRead = true;
        const bytes = await readLimitedImageBody(response, expected, controller.signal);
        if (bytes.length !== expected) throw new Error('Incomplete image range');
        cancelled(controller.signal);
        options.assertCurrent?.();
        await options.sink.write(bytes);
        offset += bytes.length;
        etag = currentEtag;
        mime = currentMime;
        if (offset === total) {
          cancelled(controller.signal);
          options.assertCurrent?.();
          return await options.sink.finish({ size: total, mime, etag });
        }
      } finally {
        if (!bodyRead) await response.body?.cancel().catch(() => undefined);
      }
    }
    throw new Error('Image range request budget exhausted');
  } catch (error) {
    await options.sink.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
