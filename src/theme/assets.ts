// Native platforms resolve assets.native.ts. The web fallback fails closed:
// browser file ownership and export need their own verified adapter.
import type { ThemePackage } from '@/theme/package';
import type { InstalledTheme } from '@/theme/repository';
import type { ThemeManifest } from '@/theme/schema';
import type { ThemeAssetChunk, ThemeAssetStreamOptions } from '@/theme/asset-stream';

export type PreparedThemeAssets = {
  assets: Record<string, string>;
  install: () => Promise<Record<string, string>>;
  dispose: () => void;
};
export function isOwnedThemeAsset(_uri: string): boolean {
  return false;
}
export function setThemeAssetReferences(_themes: readonly InstalledTheme[] | null): void {}
export async function prepareThemeAssets(_theme: ThemePackage): Promise<PreparedThemeAssets> {
  throw new Error('Theme artwork import is available on Android and iOS');
}
export async function prepareThemeAssetStream(
  _manifest: ThemeManifest,
  _chunks: AsyncIterable<ThemeAssetChunk>,
  _options: ThemeAssetStreamOptions = {}
): Promise<PreparedThemeAssets> {
  throw new Error('Theme artwork import is available on Android and iOS');
}
export function exportInstalledTheme(_theme: InstalledTheme): Uint8Array {
  throw new Error('Theme package export is available on Android and iOS');
}
