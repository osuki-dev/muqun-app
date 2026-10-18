import { expect, test } from 'bun:test';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadOriginalImageRanges, writeOriginalImageChunk } from '../image-original-ranges';

test('original download waits for asynchronous file writes before checking offsets and closing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'muqun-image-async-'));
  const path = join(directory, 'original.png');
  const file = await open(path, 'w');
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  let offset = 0;
  let written = 0;
  let closed = false;
  let finishCalled = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const handle = {
    get offset() {
      return offset;
    },
    async writeBytes(chunk: Uint8Array) {
      markStarted();
      await gate;
      const result = await file.write(chunk);
      offset += result.bytesWritten;
    },
  };
  try {
    const download = downloadOriginalImageRanges({
      size: bytes.length,
      request: async () =>
        new Response(bytes, {
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
        }),
      sink: {
        async write(chunk) {
          written = await writeOriginalImageChunk(handle, chunk, written);
        },
        async finish(info) {
          finishCalled = true;
          expect(written).toBe(info.size);
          await file.close();
          closed = true;
          return info.size;
        },
        async abort() {
          await file.close();
          closed = true;
        },
      },
    });
    await started;
    expect(finishCalled).toBe(false);
    expect(offset).toBe(0);
    release();
    expect(await download).toBe(bytes.length);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect(closed).toBe(true);
  } finally {
    release();
    if (!closed) await file.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('asynchronous write rejection and a short write remain failures', async () => {
  await expect(
    writeOriginalImageChunk(
      {
        offset: 0,
        writeBytes: async () => {
          throw new Error('disk full');
        },
      },
      new Uint8Array(2),
      0
    )
  ).rejects.toThrow('disk full');
  await expect(
    writeOriginalImageChunk({ offset: 0, writeBytes: async () => undefined }, new Uint8Array(2), 0)
  ).rejects.toThrow('Incomplete image file write');
});
