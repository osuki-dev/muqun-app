import { throwIfThemeAborted } from '@/theme/abort';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import QuickCrypto from 'react-native-quick-crypto';

import { inspectThemeImage } from '@/theme/image-inspection';
import { packTheme, type ThemePackage } from '@/theme/package';
import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { THEME_LIMITS, type ThemeManifest } from '@/theme/schema';
import { ThemeAssetLifecycle } from '@/theme/asset-lifecycle';
import { planThemeAssetInstall } from '@/theme/asset-storage-policy';
import {
  stageThemeAssetStream,
  requireThemeDiskSpace,
  type ThemeAssetChunk,
  type ThemeAssetStreamOptions,
} from '@/theme/asset-stream';

const assetDirectory = () => new Directory(Paths.document, 'theme-assets-v1');
const hash = (bytes: Uint8Array) => QuickCrypto.createHash('sha256').update(bytes).digest('hex');
const assetName = /^[a-f0-9]{64}\.(png|jpeg|webp)$/;
const pendingName = /^pending-[a-f0-9]{24}\.part$/;
const lifecycle = new ThemeAssetLifecycle();

function collectThemeAssetGarbage(): void {
  try {
    const directory = assetDirectory();
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      if (
        entry instanceof File &&
        (assetName.test(entry.name) || pendingName.test(entry.name)) &&
        lifecycle.canCollect(entry.uri)
      )
        entry.delete();
    }
  } catch {
    // Cleanup failure must not undo a durable theme selection. The quota still
    // counts unreclaimed bytes, and the next library change retries collection.
  }
}

/** Publish durable ownership before any open preview releases its reservation. */
export function setThemeAssetReferences(themes: readonly InstalledTheme[] | null): void {
  if (
    lifecycle.replaceReferences(themes?.flatMap((theme) => Object.values(theme.assets)) ?? null)
  ) {
    collectThemeAssetGarbage();
  }
}

/** Resolve only content-addressed resources inside the theme-owned directory. */
export function isOwnedThemeAsset(uri: string): boolean {
  const prefix = assetDirectory().uri.replace(/\/$/, '') + '/';
  if (!uri.startsWith(prefix) || !assetName.test(uri.slice(prefix.length))) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export type PreparedThemeAssets = {
  assets: Record<string, string>;
  install: () => Promise<Record<string, string>>;
  dispose: () => void;
};

/** Staged preview owns its bytes; it never renders a theme author's URL. */
export async function prepareThemeAssets(theme: ThemePackage): Promise<PreparedThemeAssets> {
  async function* chunks() {
    for (const [id, bytes] of Object.entries(theme.assets)) yield { id, bytes };
  }
  return prepareAssetStream(theme.manifest, chunks(), {}, 'legacy-package');
}

/** Git and other sequential producers stage directly to owned files. No fixed
 * aggregate theme or installed-library byte quota applies to this path. */
export async function prepareThemeAssetStream(
  manifest: ThemeManifest,
  chunks: AsyncIterable<ThemeAssetChunk>,
  options: ThemeAssetStreamOptions = {}
): Promise<PreparedThemeAssets> {
  return prepareAssetStream(manifest, chunks, options, 'streamed');
}

async function prepareAssetStream(
  manifest: ThemeManifest,
  chunks: AsyncIterable<ThemeAssetChunk>,
  options: ThemeAssetStreamOptions,
  policy: 'legacy-package' | 'streamed'
): Promise<PreparedThemeAssets> {
  throwIfThemeAborted(options.signal);
  const stage = new Directory(
    Paths.cache,
    `theme-stage-${QuickCrypto.randomBytes(12).toString('hex')}`
  );
  stage.create();
  const staged = new Map<string, File>();
  let disposed = false;
  let installing = false;
  let disposalRequested = false;
  let releaseReservation: (() => void) | undefined;
  const dispose = () => {
    disposalRequested = true;
    // File.copy is asynchronous in SDK 57. Retain its source until the active
    // installation settles, even if the preview is dismissed in the meantime.
    if (installing) return;
    if (disposed) return;
    disposed = true;
    releaseReservation?.();
    releaseReservation = undefined;
    try {
      if (stage.exists) stage.delete();
    } catch {
      /* Cache eviction can reclaim abandoned staging. */
    }
    collectThemeAssetGarbage();
  };
  try {
    const assets = await stageThemeAssetStream(
      manifest,
      chunks,
      {
        hash,
        rollback: dispose,
        async writeAndDecode(name, bytes, info, signal) {
          throwIfThemeAborted(signal);
          requireThemeDiskSpace(bytes.length, Paths.availableDiskSpace);
          const file = new File(stage, name);
          file.create();
          file.write(bytes);
          // Persist before requesting the next chunk. Release the native decoder
          // reference even if canceled while the asynchronous decode was running.
          const decoded = await Image.loadAsync(file.uri);
          try {
            throwIfThemeAborted(signal);
            if (
              decoded.isAnimated ||
              Math.round(decoded.width * decoded.scale) !== info.width ||
              Math.round(decoded.height * decoded.scale) !== info.height
            )
              throw new Error('Theme image could not be decoded safely');
          } finally {
            decoded.release();
          }
          staged.set(name, file);
          return file.uri;
        },
      },
      options,
      policy === 'legacy-package' ? THEME_LIMITS.extractedBytes : undefined
    );
    return {
      assets,
      dispose,
      async install() {
        throwIfThemeAborted(options.signal);
        if (disposed || disposalRequested) throw new Error('Theme preview is no longer available');
        if (installing) throw new Error('Theme installation is already in progress');
        // Reclaim abandoned owned files before quota planning, not only after a
        // failed attempt. Other previews and queued installs remain protected.
        collectThemeAssetGarbage();
        installing = true;
        try {
          return await lifecycle.install(async () => {
            throwIfThemeAborted(options.signal);
            const directory = assetDirectory();
            directory.create({ intermediates: true, idempotent: true });
            const inventory = directory.list().map((entry) => {
              if (!(entry instanceof File))
                throw new Error('Theme image storage contains an unexpected directory');
              return { name: entry.name, bytes: entry.size };
            });
            const needed = new Set(
              planThemeAssetInstall(
                inventory,
                [...staged.values()].map((file) => ({ name: file.name, bytes: file.size })),
                policy
              )
            );
            releaseReservation ??= lifecycle.reserve(
              [...staged.keys()].map((name) => new File(directory, name).uri)
            );
            const installed: Record<string, string> = {};
            for (const [id, uri] of Object.entries(assets)) {
              throwIfThemeAborted(options.signal);
              const source = new File(uri);
              const destination = new File(directory, source.name);
              if (needed.has(source.name)) {
                requireThemeDiskSpace(source.size, Paths.availableDiskSpace);
                const temporary = new File(
                  directory,
                  `pending-${QuickCrypto.randomBytes(12).toString('hex')}.part`
                );
                try {
                  await source.copy(temporary);
                  throwIfThemeAborted(options.signal);
                  if (
                    temporary.size > THEME_LIMITS.assetBytes ||
                    hash(await temporary.bytes()) !== source.name.split('.')[0]
                  )
                    throw new Error('A staged theme image is corrupt');
                  // Both paths are in the same owned directory. Publish only the
                  // fully written, verified file; never overwrite a live asset.
                  await temporary.move(destination);
                  throwIfThemeAborted(options.signal);
                  needed.delete(source.name);
                } finally {
                  // move updates the File object's URI: never delete the promoted
                  // destination through that object after a successful move.
                  if (pendingName.test(temporary.name) && temporary.exists) temporary.delete();
                }
              }
              // Content hashes are filenames, not a reason to trust preexisting bytes.
              if (
                destination.size > THEME_LIMITS.assetBytes ||
                hash(await destination.bytes()) !== source.name.split('.')[0]
              )
                throw new Error('An installed theme image is corrupt');
              installed[id] = destination.uri;
            }
            throwIfThemeAborted(options.signal);
            return installed;
          });
        } catch (error) {
          releaseReservation?.();
          releaseReservation = undefined;
          throw error;
        } finally {
          installing = false;
          if (disposalRequested) dispose();
          collectThemeAssetGarbage();
        }
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Export installed bytes only; no source URLs are contacted during sharing. */
export function exportInstalledTheme(theme: InstalledTheme): Uint8Array {
  const manifest = effectiveThemeManifest(theme);
  delete manifest.source;
  manifest.assets = {};
  const assets: Record<string, Uint8Array> = {};
  for (const [id, uri] of Object.entries(theme.assets)) {
    if (!isOwnedThemeAsset(uri)) throw new Error('An installed theme image is unavailable');
    const file = new File(uri);
    if (file.size > THEME_LIMITS.assetBytes)
      throw new Error('An installed theme image exceeds the size limit');
    const bytes = file.bytesSync();
    const info = inspectThemeImage(bytes);
    const digest = hash(bytes);
    if (!file.name.startsWith(digest + '.')) throw new Error('An installed theme image is corrupt');
    manifest.assets[id] = { path: `assets/${id}.${info.format}`, sha256: digest };
    assets[id] = bytes;
  }
  return packTheme({ manifest, assets });
}
