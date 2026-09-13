import { throwIfThemeAborted } from '@/theme/abort';
import { inspectThemeImage } from './image-inspection';
import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from './schema';

export type ThemeAssetChunk = { id: string; bytes: Uint8Array };
export type ThemeAssetProgress = {
  phase: 'staging' | 'ready';
  completedAssets: number;
  totalAssets: number;
  receivedBytes: number;
};
export type ThemeAssetStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ThemeAssetProgress) => void;
};
export type ThemeAssetStagePort = {
  hash: (bytes: Uint8Array) => string | Promise<string>;
  /** Write into the caller's unique owned stage and fully decode the file.
   * Must not retain bytes after resolving. Never fetch the URI remotely. */
  writeAndDecode: (
    name: string,
    bytes: Uint8Array,
    info: ReturnType<typeof inspectThemeImage>,
    signal?: AbortSignal
  ) => Promise<string>;
  /** Only this invocation's staging files; never installed or user-owned data. */
  rollback: () => void | Promise<void>;
};

/** No aggregate byte quota: retain only a single bounded image plus file URIs.
 * The producer must obey backpressure and cancellation, not prefetch all assets. */
export async function stageThemeAssetStream(
  input: ThemeManifest,
  chunks: AsyncIterable<ThemeAssetChunk>,
  port: ThemeAssetStagePort,
  options: ThemeAssetStreamOptions = {},
  /** The legacy all-memory ZIP path alone retains its expansion budget. */
  legacyByteLimit?: number
): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  try {
    throwIfThemeAborted(options.signal);
    const manifest = parseThemeManifest(JSON.stringify(input));
    const expected = manifest.assets ?? {};
    const totalAssets = Object.keys(expected).length;
    const seen = new Set<string>();
    const files = new Map<string, string>();
    let receivedBytes = 0;
    const progress = (phase: ThemeAssetProgress['phase']) => {
      options.onProgress?.({ phase, totalAssets, completedAssets: seen.size, receivedBytes });
      throwIfThemeAborted(options.signal);
    };
    progress('staging');
    for await (const chunk of chunks) {
      throwIfThemeAborted(options.signal);
      if (!Object.hasOwn(expected, chunk.id) || seen.has(chunk.id))
        throw new Error('Theme images do not match the manifest');
      if (!(chunk.bytes instanceof Uint8Array) || chunk.bytes.length > THEME_LIMITS.assetBytes)
        throw new Error('A theme image exceeds the decoding size limit');
      if (chunk.bytes.length > Number.MAX_SAFE_INTEGER - receivedBytes)
        throw new Error('Theme image byte accounting overflow');
      receivedBytes += chunk.bytes.length;
      if (legacyByteLimit !== undefined && receivedBytes > legacyByteLimit)
        throw new Error('Theme images exceed the package limit');
      const info = inspectThemeImage(chunk.bytes);
      const digest = await port.hash(chunk.bytes);
      throwIfThemeAborted(options.signal);
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid theme image checksum');
      if (expected[chunk.id].sha256 && expected[chunk.id].sha256 !== digest)
        throw new Error('Theme image checksum does not match');
      const name = `${digest}.${info.format}`;
      let uri = files.get(name);
      if (!uri) {
        uri = await port.writeAndDecode(name, chunk.bytes, info, options.signal);
        files.set(name, uri);
      }
      throwIfThemeAborted(options.signal);
      assets[chunk.id] = uri;
      seen.add(chunk.id);
      progress('staging');
    }
    if (seen.size !== totalAssets) throw new Error('Theme images do not match the manifest');
    progress('ready');
    return assets;
  } catch (error) {
    try {
      await port.rollback();
    } catch {
      // Preserve cancellation, ENOSPC or decode failure; OS cache eviction can
      // reclaim a stage whose own cleanup failed.
    }
    throw error;
  }
}

/** A current capacity check, not an arbitrary total theme quota. Writes must
 * still propagate ENOSPC because other apps can consume space after checking. */
export function requireThemeDiskSpace(bytes: number, availableBytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid theme image size');
  if (Number.isFinite(availableBytes) && availableBytes >= 0 && bytes > availableBytes)
    throw new Error('Not enough device storage for this theme image');
}
