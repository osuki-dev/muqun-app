export const THEME_ASSET_STORAGE_LIMITS = Object.freeze({
  bytes: 100 * 1024 * 1024,
  files: 256,
});

export type ThemeAssetInventoryEntry = { name: string; bytes: number };

/**
 * Plan additions against the entire persistent inventory, including unknown
 * filenames. Names are opaque accounting identities, not authorized paths.
 * Callers must separately authorize paths and serialize planning with writes.
 * Nothing here decides whether an existing file may be deleted.
 */
export function planThemeAssetInstall(
  inventory: readonly ThemeAssetInventoryEntry[],
  incoming: readonly ThemeAssetInventoryEntry[]
): string[] {
  const known = new Map<string, number>();
  let bytes = 0;
  const add = (entry: ThemeAssetInventoryEntry): boolean => {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      throw new Error('Theme asset size must be a nonnegative safe integer');
    if (known.has(entry.name)) {
      if (known.get(entry.name) !== entry.bytes)
        throw new Error('Conflicting sizes for the same theme asset');
      return false;
    }
    // Subtract before adding: even individually safe integers may overflow
    // when summed. Reject without ever constructing an unsafe running total.
    if (entry.bytes > THEME_ASSET_STORAGE_LIMITS.bytes - bytes)
      throw new Error('Theme asset storage exceeds 100 MiB');
    if (known.size >= THEME_ASSET_STORAGE_LIMITS.files)
      throw new Error('Theme asset storage exceeds 256 files');
    known.set(entry.name, entry.bytes);
    bytes += entry.bytes;
    return true;
  };
  inventory.forEach(add);
  const install: string[] = [];
  for (const entry of incoming) {
    if (add(entry)) install.push(entry.name);
  }
  return install;
}
