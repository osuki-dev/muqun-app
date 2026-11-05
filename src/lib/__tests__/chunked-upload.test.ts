import { describe, expect, test } from 'bun:test';
import { runChunkedUpload, type ChunkedUploadTransport } from '../chunked-upload';
import { parseUploadLimits } from '../agent-protocol';
import { maxUploadBytesFor } from '../attachment-queue';

function fixture(failures: Record<number, Error[]> = {}) {
  const calls: string[] = [];
  const transport: ChunkedUploadTransport<string> = {
    begin: async () => ({ uploadId: 'u1', chunkBytes: 4 }),
    put: async (_id, index, bytes) => {
      calls.push(`put ${index} ${bytes.length}`);
      const failure = failures[index]?.shift();
      if (failure) throw failure;
    },
    complete: async () => (calls.push('complete'), 'done'),
    abort: async () => void calls.push('abort'),
  };
  let offset = 0;
  const readChunk = async (length: number) => {
    const bytes = new Uint8Array(length).fill(offset);
    offset += length;
    return bytes;
  };
  return { calls, transport, readChunk };
}

describe('runChunkedUpload', () => {
  test('sends slices in order, retries a failed last chunk, then completes', async () => {
    const f = fixture({ 2: [new Error('Timed out'), new Error('Timed out')] });
    const result = await runChunkedUpload({
      transport: f.transport,
      readChunk: f.readChunk,
      size: 10,
      isCurrent: () => true,
      retryDelayMs: 0,
    });
    expect(result).toBe('done');
    expect(f.calls).toEqual(['put 0 4', 'put 1 4', 'put 2 2', 'put 2 2', 'put 2 2', 'complete']);
  });

  test('aborts on a final refusal and on cancellation, without completing', async () => {
    const refused = fixture({ 1: [new Error('HTTP 413: too large')] });
    await expect(
      runChunkedUpload({
        transport: refused.transport,
        readChunk: refused.readChunk,
        size: 10,
        isCurrent: () => true,
        retryDelayMs: 0,
      })
    ).rejects.toThrow('HTTP 413');
    expect(refused.calls).toEqual(['put 0 4', 'put 1 4', 'abort']);

    const cancelled = fixture();
    let live = true;
    cancelled.transport.put = async (_id, index) => {
      cancelled.calls.push(`put ${index}`);
      live = false;
    };
    await expect(
      runChunkedUpload({
        transport: cancelled.transport,
        readChunk: cancelled.readChunk,
        size: 10,
        isCurrent: () => live,
      })
    ).rejects.toThrow('cancelled');
    expect(cancelled.calls).toEqual(['put 0', 'abort']);
  });
});

describe('chunked discovery', () => {
  test('replaces the single-shot caps when the gateway advertises chunked uploads', () => {
    const limits = parseUploadLimits({
      maxBytes: 100,
      chunked: { chunkBytes: 8, maxBytes: 300, maxVideoBytes: 900, maxConcurrentPerDevice: 2 },
    });
    expect(maxUploadBytesFor('video/mp4', limits)).toBe(900);
    expect(maxUploadBytesFor('image/png', limits)).toBe(300);
    expect(maxUploadBytesFor('image/png', parseUploadLimits({ maxBytes: 100 }))).toBe(100);
  });
});
