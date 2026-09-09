import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import QuickCrypto from 'react-native-quick-crypto';

import { inspectThemeImage } from '@/theme/image-inspection';
import { packTheme, type ThemePackage } from '@/theme/package';
import type { InstalledTheme } from '@/theme/repository';
import { cloneThemeData } from '@/theme/clone';
import { THEME_LIMITS } from '@/theme/schema';

const assetDirectory = () => new Directory(Paths.document, 'theme-assets-v1');
const hash = (bytes: Uint8Array) => QuickCrypto.createHash('sha256').update(bytes).digest('hex');

/** Resolve only content-addressed resources inside the theme-owned directory. */
export function isOwnedThemeAsset(uri: string): boolean {
  const prefix = assetDirectory().uri.replace(/\/$/, '') + '/';
  if (!uri.startsWith(prefix) || !/^[a-f0-9]{64}\.(png|jpeg|webp)$/.test(uri.slice(prefix.length)))
    return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export type PreparedThemeAssets = {
  assets: Record<string, string>;
  install: () => Record<string, string>;
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
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      if (stage.exists) stage.delete();
    } catch {
      /* Cache eviction can reclaim abandoned staging. */
    }
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
      install() {
        if (disposed) throw new Error('Theme preview is no longer available');
        const directory = assetDirectory();
        directory.create({ intermediates: true, idempotent: true });
        const installed: Record<string, string> = {};
        for (const [id, uri] of Object.entries(assets)) {
          const source = new File(uri);
          const destination = new File(directory, source.name);
          if (!destination.exists) source.copy(destination);
          // Content hashes are filenames, not a reason to trust preexisting bytes.
          if (
            destination.size > THEME_LIMITS.assetBytes ||
            hash(destination.bytesSync()) !== source.name.split('.')[0]
          )
            throw new Error('An installed theme image is corrupt');
          installed[id] = destination.uri;
        }
        return installed;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Export installed bytes only; no source URLs are contacted during sharing. */
export function exportInstalledTheme(theme: InstalledTheme): Uint8Array {
  const manifest = cloneThemeData(theme.manifest);
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
