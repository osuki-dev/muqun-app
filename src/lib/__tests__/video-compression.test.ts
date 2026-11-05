import { describe, expect, mock, test } from 'bun:test';

const MB = 1024 * 1024;
const moved: string[] = [];
const protectedDirectories: string[] = [];

mock.module('expo-file-system', () => ({
  FileMode: { ReadOnly: 0 },
  Paths: { cache: 'file:///cache' },
  Directory: class {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      this.uri = `${typeof base === 'string' ? base : base.uri}/${name ?? ''}`;
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      this.uri = name ? `${typeof base === 'string' ? base : base.uri}/${name}` : (base as string);
    }
    get name() {
      return this.uri.split('/').pop() as string;
    }
    get size() {
      return this.uri.includes('small') ? 10 * MB : 50 * MB;
    }
    open() {
      return {
        readBytes: async () => new Uint8Array(),
        close() {},
      };
    }
    async move(to: { uri: string }) {
      moved.push(to.uri);
      this.uri = to.uri;
    }
    delete() {}
  },
}));
mock.module('../cache-cleanup', () => ({
  protectCacheDirectory: async (name: string) => void protectedDirectories.push(name),
}));

const { compressPickedVideo } = await import('../video-compression');
const { planVideoCompression } = await import('../video-compression-plan');

const big = { uri: 'file:///c/in.mov', name: 'in.mov', mime: 'video/quicktime', size: 40 * MB };

describe('video compression', () => {
  test('re-encodes only real videos at or above the size floor, never a playlist', () => {
    expect(planVideoCompression({ ...big, size: 4 * MB })).toBe(false);
    expect(planVideoCompression({ ...big, size: 9 * MB })).toBe(true);
    expect(planVideoCompression({ ...big, mime: 'image/png' })).toBe(false);
    // A manifest labelled video/*, or named like one, must not reach the native module.
    expect(planVideoCompression({ ...big, name: 'live.m3u8', mime: 'video/mp4' })).toBe(false);
    expect(planVideoCompression({ ...big, mime: 'application/vnd.apple.mpegurl' })).toBe(false);
  });

  test('a manifest-typed file is never handed to the compressor', async () => {
    let calls = 0;
    const compressor = {
      compress: async () => {
        calls += 1;
        return '/c/small.mp4';
      },
    };
    const playlist = { ...big, uri: 'file:///c/x.m3u8', name: 'x.m3u8', mime: 'video/mp4' };
    expect(await compressPickedVideo(playlist, compressor)).toBe(playlist);
    expect(calls).toBe(0);
  });

  test('keeps the compressed file in the leased folder when smaller, else the original', async () => {
    const ok = { compress: async () => '/tmp/small.mp4' };
    expect(await compressPickedVideo(big, ok)).toMatchObject({
      uri: 'file:///cache/VideoCompressor/small.mp4',
      name: 'in.mp4',
      mime: 'video/mp4',
      size: 10 * MB,
    });
    expect(protectedDirectories).toContain('VideoCompressor');
    expect(moved).toEqual(['file:///cache/VideoCompressor/small.mp4']);
    // Not smaller than the source, a failure, and a build without the module all keep the original.
    expect(await compressPickedVideo(big, { compress: async () => '/tmp/huge.mp4' })).toBe(big);
    expect(
      await compressPickedVideo(big, {
        compress: async () => {
          throw new Error('codec');
        },
      })
    ).toBe(big);
    expect(await compressPickedVideo(big, null)).toBe(big);
  });
});
