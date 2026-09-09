import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import QuickCrypto from 'react-native-quick-crypto';

import { inspectThemeImage } from '@/theme/image-inspection';
import { packTheme, type ThemePackage } from '@/theme/package';
import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { THEME_LIMITS } from '@/theme/schema';
import { ThemeAssetLifecycle } from '@/theme/asset-lifecycle';
import { planThemeAssetInstall } from '@/theme/asset-storage-policy';

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
  const stage = new Directory(
    Paths.cache,
    `theme-stage-${QuickCrypto.randomBytes(12).toString('hex')}`
  );
  stage.create();
  const assets: Record<string, string> = {};
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
    const expected = Object.keys(theme.manifest.assets ?? {});
    if (
      expected.length !== Object.keys(theme.assets).length ||
      expected.some((id) => !Object.hasOwn(theme.assets, id))
    )
      throw new Error('Theme images do not match the manifest');
    let total = 0;
    for (const [id, descriptor] of Object.entries(theme.manifest.assets ?? {})) {
      const bytes = theme.assets[id];
      total += bytes.length;
      if (total > THEME_LIMITS.extractedBytes)
        throw new Error('Theme images exceed the package limit');
      const info = inspectThemeImage(bytes);
      const digest = hash(bytes);
      if (descriptor.sha256 && descriptor.sha256 !== digest)
        throw new Error('Theme image checksum does not match');
      const name = `${digest}.${info.format}`;
      let file = staged.get(name);
      if (!file) {
        file = new File(stage, name);
        file.create();
        file.write(bytes);
        // Structural validation precedes decoding, so excessive dimensions never
        // reach the platform decoder. Decode sequentially and release each ref.
        const decoded = await Image.loadAsync(file.uri);
        try {
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
      }
      assets[id] = file.uri;
    }
    return {
      assets,
      dispose,
      async install() {
        if (disposed || disposalRequested) throw new Error('Theme preview is no longer available');
        if (installing) throw new Error('Theme installation is already in progress');
        // Reclaim abandoned owned files before quota planning, not only after a
        // failed attempt. Other previews and queued installs remain protected.
        collectThemeAssetGarbage();
        installing = true;
        try {
          return await lifecycle.install(async () => {
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
                [...staged.values()].map((file) => ({ name: file.name, bytes: file.size }))
              )
            );
            releaseReservation ??= lifecycle.reserve(
              [...staged.keys()].map((name) => new File(directory, name).uri)
            );
            const installed: Record<string, string> = {};
            for (const [id, uri] of Object.entries(assets)) {
              const source = new File(uri);
              const destination = new File(directory, source.name);
              if (needed.has(source.name)) {
                const temporary = new File(
                  directory,
                  `pending-${QuickCrypto.randomBytes(12).toString('hex')}.part`
                );
                try {
                  await source.copy(temporary);
                  if (
                    temporary.size > THEME_LIMITS.assetBytes ||
                    hash(await temporary.bytes()) !== source.name.split('.')[0]
                  )
                    throw new Error('A staged theme image is corrupt');
                  // Both paths are in the same owned directory. Publish only the
                  // fully written, verified file; never overwrite a live asset.
                  await temporary.move(destination);
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
