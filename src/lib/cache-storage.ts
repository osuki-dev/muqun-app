/**
 * What is in the app's cache directory, how much room each part of it takes,
 * and -- the reason this file exists at all -- which of it Muqun is allowed to
 * delete.
 *
 * The Storage section reports three buckets and offers to empty two of them.
 * The dangerous half of that sentence is the emptying, so the rule is stated
 * here as an *allow-list of names* rather than as "everything under the cache
 * except the ones we know about". The two readings differ the moment a
 * dependency starts writing somewhere new: an allow-list quietly reports the
 * unknown directory under `other` and leaves it alone, a deny-list quietly
 * deletes it. Only the first of those is a safe thing to get wrong.
 *
 * Nothing here is allowed to name a path outside the cache root. The app's real
 * data -- the MMKV stores, `theme-assets-v1`, the updates bundle -- lives under
 * `Paths.document`, and the pairing tokens and SSH keys live in the keychain;
 * none of it is reachable from a list of cache-root child names, and
 * `planCacheDeletions` re-checks that for every entry anyway rather than
 * trusting the names it was handed.
 *
 * There are no `expo-file-system` imports below. The walk is the caller's, so
 * the classification, the totals and the deletion plan are testable without a
 * device -- which is the only way to hold a rule whose failure mode is losing
 * somebody's servers.
 */

import { formatAssetSize } from './asset-display';

/** The three buckets the Storage section reports, in the order it shows them. */
export type CacheBucket = 'images' | 'temporary' | 'other';

/**
 * One entry directly beneath the cache root.
 *
 * `bytes` is the whole subtree for a directory, which is what the reader is
 * being shown: "Images" is a number about pictures, not about the one journal
 * file at the top of Glide's cache.
 */
export type CacheRootEntry = {
  /** The entry's own name, with no path in front of it. */
  name: string;
  /** Its absolute `file://` URI, as the filesystem reported it. */
  uri: string;
  /** Bytes it occupies, contents included. */
  bytes: number;
};

/** The three buckets, plus the sum, in bytes. */
export type CacheTotals = {
  images: number;
  temporary: number;
  other: number;
  total: number;
};

/**
 * Decoded and downloaded pictures, which the image libraries own.
 *
 * Verified against the sources rather than guessed, because the names are
 * theirs and change with their versions:
 *
 * - `image_manager_disk_cache` is Glide's own default directory name.
 *   `ExpoImageAppGlideModule.kt` hands the disk cache to
 *   `InternalCacheDiskCacheFactory`, which puts it under `context.cacheDir`
 *   using Glide's `DiskCache.Factory.DEFAULT_DISK_CACHE_DIR`.
 * - `com.hackemist.SDImageCache` is SDWebImage's default cache directory on
 *   iOS. `ImageModule.swift` uses `SDImageCache.shared`, which takes the
 *   default location under `Library/Caches` -- the same directory
 *   `Paths.cache` points at.
 * - `enrm_image_cache` is `react-native-enriched-markdown`'s Android image
 *   cache, named in `ImageDownloader.kt`.
 *
 * A name that turns out to be wrong costs a row's accuracy and nothing else:
 * the bytes are reported under `other`, and neither this list nor any other
 * is what deletes the two image-library directories. See
 * `DELETABLE_CACHE_DIRECTORIES`.
 */
export const IMAGE_CACHE_DIRECTORIES = [
  'image_manager_disk_cache',
  'com.hackemist.SDImageCache',
  'enrm_image_cache',
] as const;

/**
 * Copies the app made to hand a file to something else, and never the only
 * copy of anything.
 *
 * `ImagePicker`, `ImageManipulator` and `DocumentPicker` are the three Expo
 * modules' output directories, spelled the same on both platforms:
 * `ImagePickerConstants.kt` / `MediaHandler.swift`, `FileUtils.kt` /
 * `ImageManipulatorUtils.swift`, and `DocumentPickerModule.kt` /
 * `DocumentPickerModule.swift`. Every one of them holds a fresh copy the module
 * made of something the reader already has in their photo library or their
 * files app.
 */
export const TEMPORARY_CACHE_DIRECTORIES = ['ImagePicker', 'ImageManipulator', 'DocumentPicker'] as const;

/**
 * Temporary directories whose names carry a random suffix, matched by prefix.
 *
 * `theme-stage-<random>` is where `theme/assets.native.ts` unpacks a theme's
 * images before installing them into `Paths.document/theme-assets-v1`. The
 * installed copy is the theme; the stage is scaffolding, and an import that
 * was interrupted leaves one behind.
 */
export const TEMPORARY_CACHE_PREFIXES = ['theme-stage-'] as const;

/**
 * The only names the clear action may remove by path, and the whole of the
 * answer to "what can this button destroy".
 *
 * The two image-library directories are deliberately absent. Glide and
 * SDWebImage keep an open journal beside their entries and are perfectly
 * capable of rebuilding one; a directory pulled out from under either of them
 * mid-write is how a cache turns into a crash. They are emptied through
 * `Image.clearDiskCache()`, which is their own API asking them to do it, so
 * the Images bucket is still cleared -- just not by this list.
 */
export const DELETABLE_CACHE_DIRECTORIES = [
  'enrm_image_cache',
  ...TEMPORARY_CACHE_DIRECTORIES,
] as const;

/** Which bucket one cache-root entry belongs to, by name alone. */
export function classifyCacheEntry(name: string): CacheBucket {
  if ((IMAGE_CACHE_DIRECTORIES as readonly string[]).includes(name)) return 'images';
  if ((TEMPORARY_CACHE_DIRECTORIES as readonly string[]).includes(name)) return 'temporary';
  if (TEMPORARY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'temporary';
  return 'other';
}

/**
 * Whether the clear action may delete this entry by path.
 *
 * Name-shaped only: a `..` segment or a slash is not a cache-root child's name,
 * whatever the filesystem said, and an entry carrying one is refused here
 * rather than reasoned about later.
 */
export function isDeletableCacheEntry(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if ((DELETABLE_CACHE_DIRECTORIES as readonly string[]).includes(name)) return true;
  return TEMPORARY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The three buckets and their sum, from one walk of the cache root. */
export function measureCache(entries: readonly CacheRootEntry[]): CacheTotals {
  const totals: CacheTotals = { images: 0, temporary: 0, other: 0, total: 0 };
  for (const entry of entries) {
    // A negative or non-finite size is the filesystem declining to answer, not
    // a directory that gives space back.
    const bytes = Number.isFinite(entry.bytes) && entry.bytes > 0 ? entry.bytes : 0;
    totals[classifyCacheEntry(entry.name)] += bytes;
    totals.total += bytes;
  }
  return totals;
}

/**
 * What the button is offering to reclaim: the two buckets it empties, and never
 * `other`.
 */
export function clearableCacheBytes(totals: CacheTotals): number {
  return totals.images + totals.temporary;
}

/**
 * Whether `uri` names something strictly inside `rootUri`.
 *
 * The root itself is not inside itself -- deleting the cache directory rather
 * than an entry in it is the one mistake this check exists to catch -- and a
 * URI containing a `..` segment is refused outright rather than resolved,
 * because resolving it is how a check like this gets talked into `Documents`.
 */
export function isInsideCacheRoot(uri: string, rootUri: string): boolean {
  if (uri === '' || rootUri === '') return false;
  if (uri.includes('/../') || uri.endsWith('/..')) return false;
  const root = rootUri.replace(/\/+$/, '') + '/';
  if (!uri.startsWith(root)) return false;
  return uri.slice(root.length).replace(/\/+$/, '') !== '';
}

/**
 * Everything the clear action will delete, and nothing else.
 *
 * Two independent conditions, both required: the name is on the allow-list, and
 * the URI the walk reported for it really is inside the cache root. The second
 * is not redundant. The names come from a filesystem listing, and a walker that
 * reported `Paths.document` entries -- a broken caller, a symlink, a future
 * refactor that passes the wrong root -- would otherwise hand this function a
 * plausible-looking `ImagePicker` sitting next to the MMKV stores.
 */
export function planCacheDeletions(
  entries: readonly CacheRootEntry[],
  rootUri: string
): CacheRootEntry[] {
  return entries.filter(
    (entry) => isDeletableCacheEntry(entry.name) && isInsideCacheRoot(entry.uri, rootUri)
  );
}

/**
 * A byte count the way the Artifacts list already writes one, plus the zero
 * that list has no use for and this row does: an empty cache is a fact worth
 * stating, and a blank detail line reads as a row that has not finished
 * loading.
 */
export function formatCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  return formatAssetSize(bytes);
}
