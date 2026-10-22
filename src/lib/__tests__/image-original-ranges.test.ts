import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { temporaryMediaCreatedAt, planStorageCleanup } from '../cache-storage';
import {
  downloadOriginalImageRanges,
  IMAGE_RANGE_BYTES,
  MAX_ORIGINAL_IMAGE_BYTES,
  readLimitedImageBody,
  verifiedOriginalImageFile,
  assertImageEnvelopeLimit,
  fetchBoundedImageResponse,
  readOriginalImageVersion,
  type ImageRangeSink,
  type OriginalImageInfo,
} from '../image-original-ranges';

const FIXED_ETAG = `"sha256-${'a'.repeat(64)}"`;
const fixedInfo = (size: number) => ({ size, mime: 'image/png', etag: FIXED_ETAG });

/** Real temporary-file writer for the production algorithm, not a component VM. */
function fileSink() {
  const directory = mkdtempSync(join(tmpdir(), 'muqun-image-range-'));
  const partial = join(directory, 'original.part');
  const final = join(directory, 'original.png');
  const fd = openSync(partial, 'wx');
  let closed = false;
  let writes = 0;
  let maxWrite = 0;
  const close = () => {
    if (!closed) {
      closed = true;
      closeSync(fd);
    }
  };
  const sink: ImageRangeSink<{ path: string; info: OriginalImageInfo }> = {
    write(bytes) {
      writes++;
      maxWrite = Math.max(maxWrite, bytes.length);
      if (writeSync(fd, bytes) !== bytes.length) throw new Error('Short fixture write');
    },
    finish(info) {
      close();
      renameSync(partial, final);
      return { path: final, info };
    },
    abort() {
      close();
      if (existsSync(partial)) rmSync(partial);
    },
  };
  return {
    sink,
    partial,
    final,
    writes: () => writes,
    maxWrite: () => maxWrite,
    cleanup: () => {
      close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function bytesAt(start: number, length: number, seed = 0): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(length);
  for (let index = 0; index < length; index++) result[index] = (start + index + seed) % 251;
  return result;
}

function sourceHash(size: number): string {
  const hash = createHash('sha256');
  for (let offset = 0; offset < size; offset += IMAGE_RANGE_BYTES)
    hash.update(bytesAt(offset, Math.min(IMAGE_RANGE_BYTES, size - offset)));
  return hash.digest('hex');
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

function rangeResponse(
  headers: Record<string, string>,
  total: number,
  options: {
    etag?: string | null;
    start?: number;
    end?: number;
    declared?: number;
    mime?: string;
    truncated?: boolean;
  } = {}
): Response {
  const range = /^bytes=(\d+)-(\d+)$/.exec(headers.Range)!;
  const start = options.start ?? Number(range[1]);
  const end = options.end ?? Math.min(Number(range[2]), total - 1);
  const length = end - start + 1;
  const responseHeaders: Record<string, string> = {
    'Content-Type': options.mime ?? 'image/png',
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': String(options.declared ?? length),
  };
  if (options.etag !== null) responseHeaders.ETag = options.etag ?? FIXED_ETAG;
  return new Response(bytesAt(start, options.truncated ? length - 1 : length), {
    status: 206,
    headers: responseHeaders,
  });
}

describe('bounded original download against actual HTTP and filesystem', () => {
  test('authenticated image requests refuse cross-origin redirects before reaching the target', async () => {
    let targetRequests = 0;
    let authenticatedRequests = 0;
    const target = createServer((_request, response) => {
      targetRequests++;
      response.end('unexpected');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address();
    if (!targetAddress || typeof targetAddress === 'string')
      throw new Error('Missing target listener');
    const gateway = createServer((request, response) => {
      if (request.headers.authorization === 'Bearer synthetic-range-token') authenticatedRequests++;
      response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/external` });
      response.end();
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === 'string')
      throw new Error('Missing Gateway listener');
    try {
      await expect(
        fetchBoundedImageResponse(
          fetch,
          `http://127.0.0.1:${gatewayAddress.port}/image`,
          {
            headers: { Authorization: 'Bearer synthetic-range-token' },
          },
          1000
        )
      ).rejects.toThrow();
      expect(authenticatedRequests).toBe(1);
      expect(targetRequests).toBe(0);
    } finally {
      gateway.closeAllConnections();
      target.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => gateway.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ]);
    }
  });

  test('33 MiB immutable synthetic source is read by small HTTP ranges and saved byte-exact', async () => {
    const size = 33 * 1024 * 1024;
    const digest = sourceHash(size); // Once, not per range; this fixture is immutable.
    const requests: { range: string; ifRange: string | undefined; ifMatch: string | undefined }[] =
      [];
    let versionRequests = 0;
    const assetId = 'ai_immutable_fixture';
    const versionPath = `/api/agent-images/${assetId}/version`;
    const downloadPath = `/api/agent-images/${assetId}/download/${digest}`;
    const server = createServer((request, response) => {
      if (request.headers.authorization !== 'Bearer synthetic-range-token') {
        response.writeHead(401);
        response.end();
        return;
      }
      if (request.url === versionPath) {
        versionRequests++;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            data: {
              asset: {
                id: assetId,
                version: digest,
                etag: `"sha256-${digest}"`,
                size,
                mime: 'image/png',
                name: 'synthetic.png',
                url: `/api/agent-images/${assetId}/original/${digest}`,
                download_url: downloadPath,
              },
            },
          })
        );
        return;
      }
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      if (
        !range ||
        request.url !== downloadPath ||
        request.headers['if-match'] !== `"sha256-${digest}"`
      ) {
        response.writeHead(400);
        response.end();
        return;
      }
      requests.push({
        range: request.headers.range!,
        ifRange: request.headers['if-range'] as string | undefined,
        ifMatch: request.headers['if-match'] as string | undefined,
      });
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), size - 1);
      const bytes = bytesAt(start, end - start + 1);
      response.writeHead(206, {
        'Content-Type': 'image/png',
        'Content-Length': bytes.length,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        ETag: `"sha256-${digest}"`,
      });
      response.end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const file = fileSink();
    let selectedPath = '';
    try {
      const result = await downloadOriginalImageRanges({
        size,
        sink: file.sink,
        acquireVersion: async (signal) => {
          const response = await fetchBoundedImageResponse(
            fetch,
            `http://127.0.0.1:${address.port}${versionPath}`,
            { headers: { Authorization: 'Bearer synthetic-range-token' }, signal },
            15000
          );
          const fixed = await readOriginalImageVersion(response, assetId, signal);
          selectedPath = fixed.download_url;
          return fixed;
        },
        request: (headers, signal) =>
          fetchBoundedImageResponse(
            fetch,
            `http://127.0.0.1:${address.port}${selectedPath}`,
            {
              headers: { ...headers, Authorization: 'Bearer synthetic-range-token' },
              signal,
              redirect: 'error',
            },
            15000
          ),
      });
      expect(result.info.size).toBe(size);
      expect(await fileHash(result.path)).toBe(digest);
      expect(requests.length).toBe(33);
      expect(versionRequests).toBe(1);
      expect(
        requests.every(
          (request) => request.ifRange === undefined && request.ifMatch === `"sha256-${digest}"`
        )
      ).toBe(true);
      expect(file.maxWrite()).toBeLessThanOrEqual(IMAGE_RANGE_BYTES);
      expect(file.writes()).toBe(33);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);

  test('current weak metadata validator cannot authorize a multi-range original', async () => {
    const file = fileSink();
    let calls = 0;
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          request: async (headers) => {
            calls++;
            expect(headers['If-Range']).toBeUndefined();
            return rangeResponse(headers, 33 * 1024 * 1024, { etag: 'W/"metadata-only"' });
          },
        })
      ).rejects.toThrow('not safe for ranged download');
      expect(calls).toBe(1);
      expect(file.writes()).toBe(0);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('one bounded small legacy response may use a weak validator without If-Range', async () => {
    const file = fileSink();
    try {
      const result = await downloadOriginalImageRanges({
        sink: file.sink,
        request: async (headers) => {
          expect(headers['If-Range']).toBeUndefined();
          return rangeResponse(headers, 65536, { etag: 'W/"small-single-response"' });
        },
      });
      expect(result.info.size).toBe(65536);
      expect(file.writes()).toBe(1);
    } finally {
      file.cleanup();
    }
  });

  test('a strong-looking unversioned ETag alone cannot authorize a multi-range original', async () => {
    const file = fileSink();
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          request: async (headers) => rangeResponse(headers, IMAGE_RANGE_BYTES + 10),
        })
      ).rejects.toThrow('not safe for ranged download');
      expect(file.writes()).toBe(0);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('fixed-version failures including initial 200, 409 and 412 never append or reacquire', async () => {
    for (const status of [200, 409, 412, 416]) {
      const file = fileSink();
      let acquired = 0;
      let requests = 0;
      try {
        await expect(
          downloadOriginalImageRanges({
            sink: file.sink,
            acquireVersion: async () => {
              acquired++;
              return fixedInfo(100);
            },
            request: async (headers) => {
              requests++;
              expect(headers['If-Match']).toBe(FIXED_ETAG);
              expect(headers['If-Range']).toBeUndefined();
              return new Response(bytesAt(0, 100), {
                status,
                headers: { 'Content-Type': 'image/png', ETag: FIXED_ETAG, 'Content-Length': '100' },
              });
            },
          })
        ).rejects.toThrow(`HTTP ${status}`);
        expect(acquired).toBe(1);
        expect(requests).toBe(1);
        expect(file.writes()).toBe(0);
        expect(existsSync(file.partial)).toBe(false);
      } finally {
        file.cleanup();
      }
    }
  });

  test('oversized fixed descriptors and acquisition failures delete staging without requesting original bytes', async () => {
    for (const status of [200, 409, 503, 507]) {
      const file = fileSink();
      let ranges = 0;
      try {
        await expect(
          downloadOriginalImageRanges({
            sink: file.sink,
            acquireVersion: async (signal) => {
              if (status === 200) return fixedInfo(MAX_ORIGINAL_IMAGE_BYTES + 1);
              return readOriginalImageVersion(new Response('{}', { status }), 'ai_fixture', signal);
            },
            request: async (headers) => {
              ranges++;
              return rangeResponse(headers, 100);
            },
          })
        ).rejects.toThrow();
        expect(ranges).toBe(0);
        expect(existsSync(file.partial)).toBe(false);
      } finally {
        file.cleanup();
      }
    }
  });

  test('a source version change deletes the partial file rather than mixing chunks', async () => {
    const file = fileSink();
    let calls = 0;
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          acquireVersion: async () => fixedInfo(IMAGE_RANGE_BYTES + 10),
          request: async (headers) =>
            rangeResponse(headers, IMAGE_RANGE_BYTES + 10, {
              etag: ++calls === 1 ? FIXED_ETAG : `"sha256-${'b'.repeat(64)}"`,
            }),
        })
      ).rejects.toThrow('changed during download');
      expect(calls).toBe(2);
      expect(file.writes()).toBe(1);
      expect(existsSync(file.partial)).toBe(false);
      expect(existsSync(file.final)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('a full 200 response is never appended to an existing fixed-version partial', async () => {
    const file = fileSink();
    let calls = 0;
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          acquireVersion: async () => fixedInfo(IMAGE_RANGE_BYTES + 10),
          request: async (headers) =>
            ++calls === 1
              ? rangeResponse(headers, IMAGE_RANGE_BYTES + 10)
              : new Response(bytesAt(0, 10), {
                  status: 200,
                  headers: {
                    'Content-Type': 'image/png',
                    'Content-Length': '10',
                    ETag: '"new-version"',
                  },
                }),
        })
      ).rejects.toThrow('HTTP 200');
      expect(file.writes()).toBe(1);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('ignored Range with a 200 MiB declared 200 is refused before reading any body', async () => {
    const file = fileSink();
    let reads = 0;
    let cancelled = false;
    try {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(8192));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 }
      );
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          request: async () =>
            new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'image/png', 'Content-Length': String(200 * 1024 * 1024) },
            }),
        })
      ).rejects.toThrow('ignored bounded image Range');
      expect(reads).toBe(0);
      expect(cancelled).toBe(true);
      expect(file.writes()).toBe(0);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('small original-only 200 compatibility remains bounded and byte-exact', async () => {
    const file = fileSink();
    const bytes = bytesAt(0, 1000);
    try {
      const result = await downloadOriginalImageRanges({
        sink: file.sink,
        request: async () =>
          new Response(bytes, {
            headers: { 'Content-Type': 'image/png', 'Content-Length': '1000' },
          }),
      });
      expect(await fileHash(result.path)).toBe(createHash('sha256').update(bytes).digest('hex'));
    } finally {
      file.cleanup();
    }
  });

  test('cancel after one write stops further ranges and removes the owned partial', async () => {
    const file = fileSink();
    const controller = new AbortController();
    let calls = 0;
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: {
            ...file.sink,
            write(bytes) {
              file.sink.write(bytes);
              controller.abort();
            },
          },
          signal: controller.signal,
          acquireVersion: async () => fixedInfo(3 * IMAGE_RANGE_BYTES),
          request: async (headers) => {
            calls++;
            return rangeResponse(headers, 3 * IMAGE_RANGE_BYTES);
          },
        })
      ).rejects.toThrow('cancelled');
      expect(calls).toBe(1);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('connection ownership changing during a response prevents even its final write', async () => {
    const file = fileSink();
    let current = true;
    try {
      await expect(
        downloadOriginalImageRanges({
          sink: file.sink,
          assertCurrent() {
            if (!current) throw new Error('Gateway connection changed');
          },
          request: async () => {
            const body = new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  current = false;
                  controller.enqueue(bytesAt(0, 100));
                  controller.close();
                },
              },
              { highWaterMark: 0 }
            );
            return new Response(body, {
              status: 206,
              headers: {
                'Content-Type': 'image/png',
                'Content-Length': '100',
                'Content-Range': 'bytes 0-99/100',
                ETag: '"immutable"',
              },
            });
          },
        })
      ).rejects.toThrow('Gateway connection changed');
      expect(file.writes()).toBe(0);
      expect(existsSync(file.partial)).toBe(false);
    } finally {
      file.cleanup();
    }
  });

  test('range offsets, total, length, MIME, missing validator and short bodies all fail closed', async () => {
    const cases = [
      { start: 1 },
      { end: 3 },
      { declared: IMAGE_RANGE_BYTES - 1 },
      { mime: 'text/html' },
      { etag: null },
      { truncated: true },
    ];
    for (const options of cases) {
      const file = fileSink();
      try {
        await expect(
          downloadOriginalImageRanges({
            sink: file.sink,
            acquireVersion: async () => fixedInfo(IMAGE_RANGE_BYTES + 10),
            request: async (headers) => rangeResponse(headers, IMAGE_RANGE_BYTES + 10, options),
          })
        ).rejects.toThrow();
        expect(existsSync(file.partial)).toBe(false);
        expect(existsSync(file.final)).toBe(false);
      } finally {
        file.cleanup();
      }
    }
  });

  test('size metadata mismatch and over-budget sources do not produce a completed file', async () => {
    for (const size of [MAX_ORIGINAL_IMAGE_BYTES + 1, -1, NaN, 123]) {
      const file = fileSink();
      let calls = 0;
      try {
        await expect(
          downloadOriginalImageRanges({
            size,
            sink: file.sink,
            request: async (headers) => {
              calls++;
              return rangeResponse(headers, 1000);
            },
          })
        ).rejects.toThrow();
        expect(calls).toBe(size === 123 ? 1 : 0);
        expect(existsSync(file.partial)).toBe(false);
      } finally {
        file.cleanup();
      }
    }
  });

  test('a filesystem write failure deletes the partial and never publishes a completed original', async () => {
    const file = fileSink();
    try {
      await expect(
        downloadOriginalImageRanges({
          acquireVersion: async () => fixedInfo(IMAGE_RANGE_BYTES + 10),
          sink: {
            ...file.sink,
            write(bytes) {
              file.sink.write(bytes);
              throw new Error('Disk full');
            },
          },
          request: async (headers) => rangeResponse(headers, IMAGE_RANGE_BYTES + 10),
        })
      ).rejects.toThrow('Disk full');
      expect(file.writes()).toBe(1);
      expect(existsSync(file.partial)).toBe(false);
      expect(existsSync(file.final)).toBe(false);
    } finally {
      file.cleanup();
    }
  });
});

describe('bounded reads and verified file-only photo export policy', () => {
  test('rejecting oversized headers aborts the underlying request before body streaming starts', async () => {
    let signal: AbortSignal | null = null;
    let reads = 0;
    const response = await fetchBoundedImageResponse(
      async (_url, init) => {
        signal = init.signal ?? null;
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                reads++;
                controller.enqueue(new Uint8Array(8192));
              },
            },
            { highWaterMark: 0 }
          ),
          { headers: { 'Content-Length': String(200 * 1024 * 1024) } }
        );
      },
      'https://synthetic.example/original',
      {},
      1000
    );
    await expect(readLimitedImageBody(response, IMAGE_RANGE_BYTES)).rejects.toThrow('read limit');
    expect(reads).toBe(0);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  test('a stalled image body times out and aborts its native transport signal', async () => {
    let signal: AbortSignal | null = null;
    const response = await fetchBoundedImageResponse(
      async (_url, init) => {
        signal = init.signal ?? null;
        return new Response(new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }));
      },
      'https://synthetic.example/original',
      {},
      20
    );
    await expect(readLimitedImageBody(response, 32)).rejects.toThrow('Timed out');
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  test('completing a bounded image read disarms the deadline without a late request abort', async () => {
    let signal: AbortSignal | null = null;
    const response = await fetchBoundedImageResponse(
      async (_url, init) => {
        signal = init.signal ?? null;
        return new Response(bytesAt(0, 4), { headers: { 'Content-Length': '4' } });
      },
      'https://synthetic.example/original',
      {},
      20
    );
    expect((await readLimitedImageBody(response, 4)).length).toBe(4);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
  });
  test('bounded encrypted reads refuse oversized payloads and unsolicited compression before body expansion', () => {
    expect(() => assertImageEnvelopeLimit({ body: 'A'.repeat(100), headers: {} }, 16)).toThrow(
      'read limit'
    );
    expect(() =>
      assertImageEnvelopeLimit({ body: 'AAAA', headers: { 'Content-Encoding': 'gzip' } }, 16)
    ).toThrow('read limit');
    assertImageEnvelopeLimit({ body: 'AAAA', headers: {} }, 16);
    assertImageEnvelopeLimit({ body: 'AAAA', headers: { 'Content-Encoding': 'identity' } }, 16);
  });
  test('a chunked response over the limit is cancelled, not accumulated', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(33));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readLimitedImageBody(new Response(body), 32)).rejects.toThrow('read limit');
    expect(cancelled).toBe(true);
  });

  test('abort while a body read is pending cancels the stream and settles', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({}));
    const pending = readLimitedImageBody(response, 32, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });

  test('only a complete owned range-verified original bypasses the old small-buffer export path', () => {
    const cache = 'file:///synthetic/cache/';
    const uri = `${cache}file-export-123-1/original.png`;
    const info = { size: 33 * 1024 * 1024, mime: 'image/png' };
    expect(verifiedOriginalImageFile(uri, cache, info.size, info)).toBe(true);
    expect(verifiedOriginalImageFile(uri, cache, info.size - 1, info)).toBe(false);
    expect(verifiedOriginalImageFile(uri, cache, info.size, undefined)).toBe(false);
    expect(verifiedOriginalImageFile('file:///outside/original.png', cache, info.size, info)).toBe(
      false
    );
    expect(
      verifiedOriginalImageFile(
        `${cache}file-export-123-1/../../outside.png`,
        cache,
        info.size,
        info
      )
    ).toBe(false);
    expect(
      verifiedOriginalImageFile(uri, cache, MAX_ORIGINAL_IMAGE_BYTES + 1, {
        ...info,
        size: MAX_ORIGINAL_IMAGE_BYTES + 1,
      })
    ).toBe(false);
    expect(verifiedOriginalImageFile(uri, cache, info.size, { ...info, mime: 'text/plain' })).toBe(
      false
    );
  });

  test('owned download directories reuse existing interrupted-export recovery without deleting active media', () => {
    const name = 'file-export-123-1';
    const cache = 'file:///synthetic/cache/';
    const entry = { name, uri: `${cache}${name}`, bytes: 33 * 1024 * 1024, modifiedAtMs: 123 };
    const plan = (active: boolean) =>
      planStorageCleanup([entry], {
        rootUri: cache,
        nowMs: 300,
        processStartedAtMs: 200,
        protectedNames: new Set(active ? [name] : []),
      }).deletions;
    expect(temporaryMediaCreatedAt(name)).toBe(123);
    expect(plan(false)).toEqual([entry]);
    expect(plan(true)).toEqual([]);
  });
});
