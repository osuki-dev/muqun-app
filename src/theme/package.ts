import { throwIfThemeAborted } from '@/theme/abort';
import { Inflate, strToU8, zipSync } from 'fflate';

import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';
import { yieldFrame as defaultYieldFrame, type YieldFrame } from '@/theme/yield';

export type ThemePackage = { manifest: ThemeManifest; assets: Record<string, Uint8Array> };
/** ZIP entries done and ZIP entries there are. Monotonic, and never restated. */
export type ThemeUnpackProgress = { completed: number; total: number };

/**
 * How much uninterrupted work one block of the unpack is allowed to be.
 *
 * A starting point, not a measured optimum. The intent is that one block lands
 * on the order of a frame rather than a fraction of one, which for the
 * table-driven CRC loop below is an assumption about JS throughput on the
 * target phones. A 25 MiB package is then roughly a hundred yields, which is
 * nothing against the inflate itself. If a block measures tens of
 * milliseconds on device, halve it; if the yields show up in the total,
 * double it.
 */
const YIELD_BYTES = 256 * 1024;
type Entry = {
  name: string;
  size: number;
  compressed: number;
  method: number;
  crc: number;
  offset: number;
  flags: number;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
/** One slice of a CRC32, carrying the register in and out so the whole checksum
 * can be computed across several blocks with a yield between them. `0xffffffff`
 * in and `^ 0xffffffff` out are the same pre- and post-conditioning a
 * single-shot CRC does; splitting the loop changes nothing about the result. */
function crc32Slice(crc: number, bytes: Uint8Array, start: number, end: number) {
  for (let index = start; index < end; index++)
    crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return crc;
}
function invalid(message: string): never {
  throw new Error(`Invalid theme package: ${message}`);
}

/** Parse directory metadata before decoding. No archive path ever becomes a device path. */
function entries(bytes: Uint8Array): { entries: Entry[]; directory: number } {
  if (bytes.length > THEME_LIMITS.packageBytes) invalid('package exceeds 25 MiB');
  if (bytes.length < 22) invalid('truncated ZIP');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65557) || end + 22 + u16(end + 20) !== bytes.length)
    invalid('missing ZIP directory');
  const count = u16(end + 10);
  const directory = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count > THEME_LIMITS.assets + 2 ||
    directory + u32(end + 12) !== end
  )
    invalid('unsupported ZIP directory');
  const result: Entry[] = [];
  const names = new Set<string>();
  let offset = directory;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) invalid('truncated ZIP entry');
    const nameLength = u16(offset + 28);
    const next = offset + 46 + nameLength + u16(offset + 30) + u16(offset + 32);
    if (next > end || u16(offset + 34)) invalid('invalid ZIP entry length');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    if (
      name !== 'theme.json' &&
      name !== 'assets/' &&
      !/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(name)
    )
      invalid('unsupported or unsafe path');
    if (names.has(name.toLowerCase())) invalid('duplicate path');
    names.add(name.toLowerCase());
    const flags = u16(offset + 8);
    const method = u16(offset + 10);
    const fileType = (u32(offset + 38) >>> 16) & 0xf000;
    if (
      flags & ~0x808 ||
      (method !== 0 && method !== 8) ||
      (fileType !== 0 && fileType !== 0x8000 && !(name === 'assets/' && fileType === 0x4000))
    )
      invalid('encrypted, linked or unsupported entry');
    const size = u32(offset + 24);
    const limit =
      name === 'theme.json'
        ? THEME_LIMITS.manifestBytes
        : name === 'assets/'
          ? 0
          : THEME_LIMITS.assetBytes;
    expanded += size;
    if (size > limit || expanded > THEME_LIMITS.extractedBytes) invalid('expanded size limit');
    result.push({
      name,
      size,
      compressed: u32(offset + 20),
      crc: u32(offset + 16),
      offset: u32(offset + 42),
      flags,
      method,
    });
    offset = next;
  }
  if (offset !== end || !names.has('theme.json'))
    invalid('missing theme.json or extra directory bytes');
  result.sort((a, b) => a.offset - b.offset);
  return { entries: result, directory };
}

/**
 * The unpack itself, once, as a generator that can be stopped.
 *
 * There is one body and two ways to drive it: `unpackTheme` runs it straight
 * through, `unpackThemeAsync` hands the frame back at every point it pauses.
 * Two implementations would have been the wrong answer -- this is a security
 * boundary, and every bound, every checksum and every structural check in here
 * must exist exactly once or the two copies will drift and one of them will be
 * the lenient one.
 *
 * A `yield` is a place the work may be interrupted, nothing more. A yielded
 * `ThemeUnpackProgress` additionally says an entry finished; a yielded `null`
 * is a pause in the middle of one, which is where the long stretches are.
 *
 * Bounded incremental DEFLATE throughout: dishonest declared sizes cannot
 * allocate an unbounded result.
 */
function* unpackThemeSteps(
  bytes: Uint8Array,
  signal?: AbortSignal
): Generator<ThemeUnpackProgress | null, ThemePackage> {
  const archive = entries(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let expectedOffset = 0;
  // An archive holds at most `THEME_LIMITS.assets + 2` entries, so a report
  // between each one is cheap and is what makes the counter move. Said once
  // before any work, so the bar exists before it has anything to show.
  const total = archive.entries.length;
  let completed = 0;
  yield { completed, total };
  for (const entry of archive.entries) {
    throwIfThemeAborted(signal);
    const offset = entry.offset;
    if (
      offset !== expectedOffset ||
      offset + 30 > archive.directory ||
      view.getUint32(offset, true) !== 0x04034b50
    )
      invalid('overlapping or missing local entry');
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    const end = start + entry.compressed;
    if (end > archive.directory || start > end) invalid('truncated entry data');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 30, offset + 30 + nameLength)
    );
    if (
      name !== entry.name ||
      view.getUint16(offset + 6, true) !== entry.flags ||
      view.getUint16(offset + 8, true) !== entry.method
    )
      invalid('local entry disagrees with directory');
    if (
      !(entry.flags & 8) &&
      (view.getUint32(offset + 14, true) !== entry.crc ||
        view.getUint32(offset + 18, true) !== entry.compressed ||
        view.getUint32(offset + 22, true) !== entry.size)
    )
      invalid('local sizes disagree');
    expectedOffset = end;
    if (entry.flags & 8) {
      if (expectedOffset + 12 > archive.directory) invalid('missing data descriptor');
      if (view.getUint32(expectedOffset, true) === 0x08074b50) expectedOffset += 4;
      if (
        expectedOffset + 12 > archive.directory ||
        view.getUint32(expectedOffset, true) !== entry.crc ||
        view.getUint32(expectedOffset + 4, true) !== entry.compressed ||
        view.getUint32(expectedOffset + 8, true) !== entry.size
      )
        invalid('invalid data descriptor');
      expectedOffset += 12;
    }
    const output = new Uint8Array(entry.size);
    let written = 0;
    const accept = (chunk: Uint8Array) => {
      if (written + chunk.length > output.length) invalid('actual expansion exceeds declared size');
      output.set(chunk, written);
      written += chunk.length;
    };
    if (entry.method === 0) accept(bytes.subarray(start, end));
    else {
      const inflater = new Inflate((chunk) => accept(chunk));
      // Limit temporary decoder output even when the ZIP lies about original size.
      let sinceYield = 0;
      for (let cursor = start; cursor < end; cursor += 1024) {
        throwIfThemeAborted(signal);
        inflater.push(bytes.subarray(cursor, Math.min(cursor + 1024, end)), cursor + 1024 >= end);
        // The 1 KiB slices are the decoder's memory bound, not a yield
        // granularity: a yield every kilobyte would be more scheduling than
        // inflating. One every `YIELD_BYTES` of compressed input instead, and
        // never on the last slice, where the entry's own pause is next anyway.
        sinceYield += 1024;
        if (sinceYield >= YIELD_BYTES && cursor + 1024 < end) {
          sinceYield = 0;
          yield null;
        }
      }
    }
    if (written !== entry.size) invalid('size or checksum mismatch');
    // The single largest uninterrupted block in the old path: one pass of a
    // byte-at-a-time table loop over the whole expanded entry, which for an
    // 8 MiB image is eight million iterations with no way in for a frame.
    let crc = 0xffffffff;
    for (let cursor = 0; cursor < output.length; cursor += YIELD_BYTES) {
      throwIfThemeAborted(signal);
      crc = crc32Slice(crc, output, cursor, Math.min(cursor + YIELD_BYTES, output.length));
      if (cursor + YIELD_BYTES < output.length) yield null;
    }
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc) invalid('size or checksum mismatch');
    files.set(name, output);
    completed++;
    yield { completed, total };
  }
  if (expectedOffset !== archive.directory) invalid('unreferenced bytes');
  const manifest = parseThemeManifest(
    new TextDecoder('utf-8', { fatal: true }).decode(files.get('theme.json')!)
  );
  const assets: Record<string, Uint8Array> = {};
  const declared = new Set(['theme.json', 'assets/']);
  for (const [id, asset] of Object.entries(manifest.assets ?? {})) {
    if (!('path' in asset)) invalid('offline packages must contain their images');
    const content = files.get(asset.path);
    if (!content) invalid('declared image is missing');
    declared.add(asset.path);
    assets[id] = content;
  }
  if ([...files.keys()].some((name) => !declared.has(name))) invalid('undeclared files');
  return { manifest, assets };
}

/**
 * The whole unpack, on this thread, without stopping.
 *
 * Still the export for every caller that is not drawing progress while it
 * waits -- the file viewer, the terminal's theme drop, the local file read.
 * Those already run behind a screen that says what it is doing, and a
 * synchronous call that cannot be interleaved is the simpler thing for them to
 * reason about.
 */
export function unpackTheme(bytes: Uint8Array, signal?: AbortSignal): ThemePackage {
  const steps = unpackThemeSteps(bytes, signal);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The same unpack, handing the frame back at every pause.
 *
 * This is what a download installs through, because that is the path with a
 * reader watching it: between the end of the download and the first asset
 * landing, the old synchronous call held the JS thread for the entire archive
 * and the app drew nothing at all.
 *
 * `throwIfThemeAborted` runs immediately after every yield as well as inside
 * the generator, because a cancellation that arrives *during* the yield is
 * exactly the one this is for -- the reader swiped the sheet away while the
 * inflate was running.
 */
export async function unpackThemeAsync(
  bytes: Uint8Array,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ThemeUnpackProgress) => void;
    /** Test seam. The real one is a macrotask; see `@/theme/yield`. */
    yieldFrame?: YieldFrame;
  } = {}
): Promise<ThemePackage> {
  const hand = options.yieldFrame ?? defaultYieldFrame;
  const steps = unpackThemeSteps(bytes, options.signal);
  let step = steps.next();
  while (!step.done) {
    // Reported before the yield, so the value the frame paints is this one and
    // not the previous one.
    if (step.value) options.onProgress?.(step.value);
    await hand();
    throwIfThemeAborted(options.signal);
    step = steps.next();
  }
  return step.value;
}

/** Call after image verification. Package contains no device paths or connection data. */
export function packTheme(theme: ThemePackage): Uint8Array {
  const manifest = parseThemeManifest(JSON.stringify(theme.manifest));
  const files: Record<string, Uint8Array> = {
    'theme.json': strToU8(JSON.stringify(manifest, null, 2)),
  };
  const paths = new Map<string, string>();
  const assetIds = Object.keys(manifest.assets ?? {});
  if (
    Object.keys(theme.assets).length !== assetIds.length ||
    assetIds.some(
      (id) => !Object.hasOwn(theme.assets, id) || !(theme.assets[id] instanceof Uint8Array)
    )
  )
    invalid('asset keys do not match the manifest');
  let size = files['theme.json'].length;
  for (const [id, asset] of Object.entries(manifest.assets ?? {})) {
    if (!('path' in asset) || !theme.assets[id])
      invalid('offline export requires installed assets');
    const content = theme.assets[id];
    if (content.length > THEME_LIMITS.assetBytes) invalid('image exceeds 8 MiB');
    const existingPath = paths.get(asset.path.toLowerCase());
    if (existingPath && existingPath !== asset.path)
      invalid('case-insensitive asset path collision');
    paths.set(asset.path.toLowerCase(), asset.path);
    if (
      files[asset.path] &&
      (files[asset.path].length !== content.length ||
        files[asset.path].some((byte, index) => byte !== content[index]))
    )
      invalid('conflicting asset paths');
    if (!files[asset.path]) size += content.length;
    files[asset.path] = content;
  }
  if (
    Object.keys(theme.assets).length !== Object.keys(manifest.assets ?? {}).length ||
    size > THEME_LIMITS.extractedBytes
  )
    invalid('asset count or expanded size limit');
  // Image formats already compress their pixels. Store avoids slow redundant compression.
  const result = zipSync(files, { level: 0 });
  if (result.length > THEME_LIMITS.packageBytes) invalid('package exceeds 25 MiB');
  return result;
}
