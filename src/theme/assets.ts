// Native platforms resolve assets.native.ts. The web fallback fails closed:
// browser file ownership and export need their own verified adapter.
import type { ThemePackage } from '@/theme/package';
import type { InstalledTheme } from '@/theme/repository';

export type PreparedThemeAssets = {
  assets: Record<string, string>;
  install: () => Record<string, string>;
  dispose: () => void;
};
export function isOwnedThemeAsset(_uri: string): boolean {
  return false;
}
export async function prepareThemeAssets(_theme: ThemePackage): Promise<PreparedThemeAssets> {
  throw new Error('Theme artwork import is available on Android and iOS');
}
export function exportInstalledTheme(_theme: InstalledTheme): Uint8Array {
  throw new Error('Theme package export is available on Android and iOS');
}
