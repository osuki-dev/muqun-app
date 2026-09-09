import { expect, test } from 'bun:test';
import { inspectThemeImage } from '../image-inspection';
import { THEME_LIMITS } from '../schema';

// Structural fixtures intentionally omit valid compressed pixels; native decode is a separate gate.
const ascii = (value: string) => Array.from(value, (char) => char.charCodeAt(0));
const u32 = (n: number, little = false) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, little);
  return [...b];
};
function chunk(type: string, payload: number[]) {
  const body = [...ascii(type), ...payload];
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return [...u32(payload.length), ...body, ...u32((crc ^ 0xffffffff) >>> 0)];
}
function png(width = 2, height = 3, extra: number[] = []) {
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...extra,
    ...chunk('IDAT', [0]),
    ...chunk('IEND', []),
  ]);
}
function jpeg(width = 2, height = 3) {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    1,
    0xff,
    0,
    2,
    0xff,
    0xd0,
    3,
    0xff,
    0xd9,
  ]);
}
function riffChunk(type: string, payload: number[]) {
  return [
    ...ascii(type),
    ...u32(payload.length, true),
    ...payload,
    ...(payload.length % 2 ? [0] : []),
  ];
}
function webp(...chunks: number[][]) {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length, true), ...body]);
}
const vp8 = () => riffChunk('VP8 ', [0x10, 0, 0, 0x9d, 1, 0x2a, 2, 0, 3, 0, 0]);
const vp8l = () => riffChunk('VP8L', [0x2f, ...u32(1 | (2 << 14), true), 0]);
const vp8x = (flags = 0, width = 2) =>
  riffChunk('VP8X', [flags, 0, 0, 0, width - 1, 0, 0, 2, 0, 0]);

test('recognizes bounded PNG, baseline JPEG and both WebP encodings', () => {
  expect(inspectThemeImage(png())).toEqual({ format: 'png', width: 2, height: 3 });
  expect(inspectThemeImage(jpeg())).toEqual({ format: 'jpeg', width: 2, height: 3 });
  for (const bytes of [webp(vp8()), webp(vp8l()), webp(vp8x(), vp8())]) {
    expect(inspectThemeImage(bytes)).toEqual({ format: 'webp', width: 2, height: 3 });
  }
});

test('honors Uint8Array slice offsets', () => {
  const source = png();
  const backing = new Uint8Array(source.length + 6);
  backing.set(source, 3);
  expect(inspectThemeImage(backing.subarray(3, -3)).width).toBe(2);
});

test('rejects every truncated prefix and trailing bytes', () => {
  for (const original of [png(), jpeg(), webp(vp8()), webp(vp8l()), webp(vp8x(), vp8())]) {
    for (let length = 0; length < original.length; length++) {
      expect(() => inspectThemeImage(original.subarray(0, length))).toThrow();
    }
    expect(() => inspectThemeImage(new Uint8Array([...original, 0]))).toThrow();
  }
});

test('rejects APNG chunks regardless of placement and WebP animation with or without flags', () => {
  for (const type of ['acTL', 'fcTL', 'fdAT'])
    expect(() => inspectThemeImage(png(2, 3, chunk(type, [])))).toThrow();
  for (const bytes of [
    webp(vp8x(2), vp8()),
    webp(vp8x(), riffChunk('ANIM', []), vp8()),
    webp(vp8x(), vp8(), riffChunk('ANMF', [])),
  ]) {
    expect(() => inspectThemeImage(bytes)).toThrow();
  }
});

test('rejects zero dimensions, huge pixel counts and excessive encoded bytes', () => {
  for (const bytes of [
    png(0),
    png(0xffffffff, 0xffffffff),
    png(4001, 4000),
    jpeg(0),
    jpeg(65535, 65535),
    new Uint8Array(THEME_LIMITS.assetBytes + 1),
  ]) {
    expect(() => inspectThemeImage(bytes)).toThrow();
  }
  expect(inspectThemeImage(png(4000, 4000)).width).toBe(4000);
});

test('rejects CRC corruption, duplicated PNG headers, missing data and overflowing chunks', () => {
  const corrupt = png();
  corrupt[29] ^= 1;
  expect(() => inspectThemeImage(corrupt)).toThrow();
  expect(() => inspectThemeImage(png(2, 3, chunk('IHDR', [])))).toThrow();
  const missingData = new Uint8Array([...png().subarray(0, 33), ...chunk('IEND', [])]);
  expect(() => inspectThemeImage(missingData)).toThrow();
  const overflow = png();
  overflow.set(u32(0xffffffff), 33);
  expect(() => inspectThemeImage(overflow)).toThrow();
});

test('rejects invalid JPEG segment lengths, unsupported frames and missing scan', () => {
  const badLength = jpeg();
  badLength[5] = 255;
  const unsupported = jpeg();
  unsupported[3] = 0xc3;
  const components = jpeg();
  components[11] = 4;
  const missingScan = new Uint8Array([...jpeg().subarray(0, 15), 0xff, 0xd9]);
  for (const bytes of [badLength, unsupported, components, missingScan])
    expect(() => inspectThemeImage(bytes)).toThrow();
});

test('rejects WebP mismatched canvas, duplicate image, bad padding, version and frame headers', () => {
  const padding = webp(vp8());
  padding[padding.length - 1] = 1;
  const version = webp(riffChunk('VP8L', [0x2f, 0, 0, 0, 0xe0, 0]));
  const badFrame = webp(riffChunk('VP8 ', [0x11, 0, 0, 0x9d, 1, 0x2a, 2, 0, 3, 0, 0]));
  const overflow = webp(vp8());
  overflow.set(u32(0xffffffff, true), 16);
  for (const bytes of [
    webp(vp8x(0, 3), vp8()),
    webp(vp8(), vp8l()),
    webp(vp8x()),
    padding,
    version,
    badFrame,
    overflow,
  ]) {
    expect(() => inspectThemeImage(bytes)).toThrow();
  }
});

test('rejects unsupported formats regardless of extension or MIME claimed elsewhere', () => {
  for (const text of ['GIF89a', '<svg width="2" height="3"/>', 'not an image']) {
    expect(() => inspectThemeImage(new TextEncoder().encode(text))).toThrow();
  }
});
