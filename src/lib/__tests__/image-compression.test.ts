import { describe, expect, test } from 'bun:test';

import type { PickedFile } from '../attachment-queue';
import {
  COMPRESSED_IMAGE_MIME,
  COMPRESSED_IMAGE_QUALITY,
  MAX_IMAGE_EDGE,
  planImageCompression,
  withCompressedExtension,
} from '../image-compression';

function pick(overrides: Partial<PickedFile> = {}): PickedFile {
  return {
    uri: 'file:///local/IMG_0001.jpg',
    name: 'IMG_0001.jpg',
    mime: 'image/jpeg',
    width: 4032,
    height: 3024,
    ...overrides,
  };
}

describe('planImageCompression', () => {
  test('re-encodes an oversized camera photo to the shared format', () => {
    const plan = planImageCompression(pick());
    expect(plan).not.toBeNull();
    expect(plan?.mime).toBe(COMPRESSED_IMAGE_MIME);
    expect(plan?.quality).toBe(COMPRESSED_IMAGE_QUALITY);
    expect(plan?.name).toBe('IMG_0001.webp');
  });

  test('pins the long edge and leaves the other one to follow', () => {
    expect(planImageCompression(pick({ width: 4032, height: 3024 }))?.resize).toEqual({
      width: MAX_IMAGE_EDGE,
    });
    expect(planImageCompression(pick({ width: 3024, height: 4032 }))?.resize).toEqual({
      height: MAX_IMAGE_EDGE,
    });
  });

  test('a square image pins one edge only, so it stays square', () => {
    const resize = planImageCompression(pick({ width: 3000, height: 3000 }))?.resize;
    expect(resize).toEqual({ width: MAX_IMAGE_EDGE });
    expect(Object.keys(resize ?? {})).toHaveLength(1);
  });

  test('an image already within the limit is re-encoded but not resized', () => {
    const plan = planImageCompression(pick({ width: 1600, height: 1200 }));
    expect(plan?.resize).toBe(undefined);
    expect(plan?.mime).toBe(COMPRESSED_IMAGE_MIME);
  });

  test('exactly the limit is not oversized', () => {
    expect(planImageCompression(pick({ width: MAX_IMAGE_EDGE, height: 1200 }))?.resize).toBe(
      undefined
    );
    expect(planImageCompression(pick({ width: MAX_IMAGE_EDGE + 1, height: 1200 }))?.resize).toEqual(
      {
        width: MAX_IMAGE_EDGE,
      }
    );
  });

  test('an image that is already the target format and small enough is left alone', () => {
    expect(
      planImageCompression(
        pick({ mime: COMPRESSED_IMAGE_MIME, name: 'sticker.webp', width: 900, height: 700 })
      )
    ).toBeNull();
  });

  test('but a target-format image that is too big is still resized', () => {
    const plan = planImageCompression(
      pick({ mime: COMPRESSED_IMAGE_MIME, name: 'huge.webp', width: 5000, height: 400 })
    );
    expect(plan?.resize).toEqual({ width: MAX_IMAGE_EDGE });
  });

  test('animated images are left alone rather than flattened to one frame', () => {
    expect(planImageCompression(pick({ mime: 'image/gif', name: 'wave.gif' }))).toBeNull();
    expect(planImageCompression(pick({ mime: 'image/apng', name: 'wave.apng' }))).toBeNull();
  });

  test('a non-image is left alone', () => {
    expect(
      planImageCompression(pick({ mime: 'application/pdf', name: 'contract.pdf' }))
    ).toBeNull();
    expect(
      planImageCompression(pick({ mime: 'application/octet-stream', name: 'blob.bin' }))
    ).toBeNull();
  });

  test('HEIC and PNG picks are normalised to the shared format', () => {
    for (const [mime, name] of [
      ['image/heic', 'IMG_0002.HEIC'],
      ['image/png', 'shot.png'],
    ]) {
      const plan = planImageCompression(pick({ mime, name, width: 1000, height: 800 }));
      expect(plan?.mime).toBe(COMPRESSED_IMAGE_MIME);
      expect(plan?.resize).toBe(undefined);
    }
  });

  test('unknown dimensions still re-encode, but never guess a resize', () => {
    for (const dimensions of [
      { width: undefined, height: undefined },
      { width: 4000, height: undefined },
      { width: 0, height: 0 },
      { width: Number.NaN, height: 3000 },
    ]) {
      const plan = planImageCompression(pick(dimensions));
      expect(plan?.mime).toBe(COMPRESSED_IMAGE_MIME);
      expect(plan?.resize).toBe(undefined);
    }
  });
});

describe('withCompressedExtension', () => {
  test('replaces the picker extension with the one the bytes will have', () => {
    expect(withCompressedExtension('IMG_0001.jpg')).toBe('IMG_0001.webp');
    expect(withCompressedExtension('IMG_0002.HEIC')).toBe('IMG_0002.webp');
    expect(withCompressedExtension('holiday.2024.png')).toBe('holiday.2024.webp');
  });

  test('adds one when the name has none', () => {
    expect(withCompressedExtension('scan')).toBe('scan.webp');
  });

  test('a leading dot is a hidden name, not an extension', () => {
    expect(withCompressedExtension('.hidden')).toBe('.hidden.webp');
  });

  test('an empty name still produces something uploadable', () => {
    expect(withCompressedExtension('   ')).toBe('image.webp');
  });
});
