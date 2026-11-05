import { describe, expect, mock, test } from 'bun:test';

mock.module('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    get size() {
      return this.uri.endsWith('small.mp4') ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    }
  },
}));

const { compressPickedVideo } = await import('../video-compression');
const { planVideoCompression } = await import('../video-compression-plan');

const big = {
  uri: 'file:///c/in.mov',
  name: 'in.mov',
  mime: 'video/quicktime',
  size: 40 * 1024 * 1024,
};

describe('video compression', () => {
  test('re-encodes only videos at or above the size floor', () => {
    expect(planVideoCompression({ mime: 'video/mp4', size: 4 * 1024 * 1024 })).toBe(false);
    expect(planVideoCompression({ mime: 'video/mp4', size: 9 * 1024 * 1024 })).toBe(true);
    expect(planVideoCompression({ mime: 'image/png', size: 90 * 1024 * 1024 })).toBe(false);
  });

  test('uses the compressed file when smaller, else the original', async () => {
    const ok = { compress: async () => '/c/small.mp4' };
    expect(await compressPickedVideo(big, ok)).toMatchObject({
      uri: 'file:///c/small.mp4',
      name: 'in.mp4',
      mime: 'video/mp4',
      size: 10 * 1024 * 1024,
    });
    // Not smaller than the source, a failure, and a build without the module all keep the original.
    expect(await compressPickedVideo(big, { compress: async () => '/c/huge.mp4' })).toBe(big);
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
