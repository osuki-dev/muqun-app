import { THEME_LIMITS } from './schema';

export type ThemeImageInfo = { format: 'png' | 'jpeg' | 'webp'; width: number; height: number };

function requireImage(condition: unknown): asserts condition {
  if (!condition) throw new Error('Unsupported or malformed static theme image');
}

function dimensions(
  format: ThemeImageInfo['format'],
  width: number,
  height: number
): ThemeImageInfo {
  requireImage(width > 0 && height > 0 && width * height <= THEME_LIMITS.imagePixels);
  return { format, width, height };
}

function word(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(bytes: Uint8Array, view: DataView): ThemeImageInfo {
  let offset = 8;
  let info: ThemeImageInfo | undefined;
  let data = false;
  let dataEnded = false;
  let palette = false;
  let color = 0;
  while (offset < bytes.length) {
    requireImage(offset + 12 <= bytes.length);
    const size = view.getUint32(offset);
    const type = word(bytes, offset + 4);
    const end = offset + 8 + size;
    requireImage(end + 4 <= bytes.length && /^[A-Za-z]{4}$/.test(type));
    requireImage((bytes[offset + 6] & 32) === 0);
    requireImage(crc32(bytes, offset + 4, end) === view.getUint32(end));
    requireImage(!['acTL', 'fcTL', 'fdAT'].includes(type));
    if (!info) {
      requireImage(type === 'IHDR' && size === 13);
      info = dimensions('png', view.getUint32(offset + 8), view.getUint32(offset + 12));
      const depth = bytes[offset + 16];
      color = bytes[offset + 17];
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      requireImage(depths[color]?.includes(depth));
      requireImage(bytes[offset + 18] === 0 && bytes[offset + 19] === 0 && bytes[offset + 20] <= 1);
    } else if (type === 'IDAT') {
      requireImage(!dataEnded && (color !== 3 || palette));
      data = true;
    } else if (type === 'IEND') {
      requireImage(size === 0 && data && end + 4 === bytes.length);
      return info;
    } else {
      requireImage(type !== 'IHDR');
      if (data) dataEnded = true;
      if (type === 'PLTE') {
        requireImage(
          !palette &&
            !data &&
            size > 0 &&
            size <= 768 &&
            size % 3 === 0 &&
            color !== 0 &&
            color !== 4
        );
        palette = true;
      } else requireImage((bytes[offset + 4] & 32) !== 0);
    }
    offset = end + 4;
  }
  throw new Error('Theme PNG is missing its end chunk');
}

function jpeg(bytes: Uint8Array, view: DataView): ThemeImageInfo {
  let offset = 2;
  let info: ThemeImageInfo | undefined;
  let scan = false;
  while (offset < bytes.length) {
    requireImage(bytes[offset++] === 0xff);
    while (bytes[offset] === 0xff) offset++;
    requireImage(offset < bytes.length);
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      requireImage(info && scan && offset === bytes.length);
      return info;
    }
    requireImage(marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7));
    requireImage(offset + 2 <= bytes.length);
    const size = view.getUint16(offset);
    requireImage(size >= 2 && offset + size <= bytes.length);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      // Baseline, extended sequential and progressive DCT are the interoperable subset.
      requireImage(!info && [0xc0, 0xc1, 0xc2].includes(marker) && size >= 8);
      const components = bytes[offset + 7];
      requireImage(
        bytes[offset + 2] === 8 && components > 0 && components <= 4 && size === 8 + components * 3
      );
      info = dimensions('jpeg', view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    if (marker === 0xda) {
      requireImage(info && size >= 6);
      const components = bytes[offset + 2];
      requireImage(components > 0 && components <= 4 && size === 6 + components * 2);
      scan = true;
      offset += size;
      // Skip entropy bytes, stuffing and restart markers; inspect every later marker.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const start = offset++;
        while (bytes[offset] === 0xff) offset++;
        requireImage(offset < bytes.length);
        const next = bytes[offset];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset++;
          continue;
        }
        offset = start;
        break;
      }
    } else offset += size;
  }
  throw new Error('Theme JPEG is missing its end marker');
}

function webp(bytes: Uint8Array, view: DataView): ThemeImageInfo {
  requireImage(view.getUint32(4, true) + 8 === bytes.length);
  let offset = 12;
  let canvas: ThemeImageInfo | undefined;
  let frame: ThemeImageInfo | undefined;
  let alpha = false;
  while (offset < bytes.length) {
    requireImage(offset + 8 <= bytes.length);
    const type = word(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    const padded = end + (size % 2);
    requireImage(padded <= bytes.length && (size % 2 === 0 || bytes[end] === 0));
    requireImage(type !== 'ANIM' && type !== 'ANMF');
    if (offset === 12) requireImage(['VP8X', 'VP8 ', 'VP8L'].includes(type));
    if (type === 'VP8X') {
      requireImage(offset === 12 && size === 10 && !canvas);
      requireImage(
        (bytes[start] & 0xc3) === 0 &&
          bytes[start + 1] === 0 &&
          bytes[start + 2] === 0 &&
          bytes[start + 3] === 0
      );
      const uint24 = (at: number) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
      canvas = dimensions('webp', uint24(start + 4) + 1, uint24(start + 7) + 1);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      requireImage(!frame);
      if (type === 'VP8 ') {
        requireImage(size > 10 && (bytes[start] & 1) === 0 && (bytes[start] & 16) !== 0);
        requireImage(
          bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a
        );
        const partitionSize = (view.getUint32(start, true) & 0xffffff) >>> 5;
        requireImage(partitionSize <= size - 10);
        frame = dimensions(
          'webp',
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff
        );
      } else {
        requireImage(size > 5 && bytes[start] === 0x2f && !alpha);
        const bits = view.getUint32(start + 1, true);
        requireImage(bits >>> 29 === 0);
        frame = dimensions('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
    } else if (type === 'ALPH') {
      requireImage(canvas && !frame && !alpha && size > 1);
      alpha = true;
    } else requireImage(canvas);
    offset = padded;
  }
  requireImage(frame);
  requireImage(!canvas || (frame.width === canvas.width && frame.height === canvas.height));
  return frame;
}

/** Bounded container inspection, not a pixel decoder. Native decoding must still succeed before installation. */
export function inspectThemeImage(bytes: Uint8Array): ThemeImageInfo {
  requireImage(bytes.length > 0 && bytes.length <= THEME_LIMITS.assetBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  )
    return png(bytes, view);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes, view);
  if (bytes.length >= 12 && word(bytes, 0) === 'RIFF' && word(bytes, 8) === 'WEBP')
    return webp(bytes, view);
  throw new Error('Theme images must be static PNG, JPEG or WebP files');
}
