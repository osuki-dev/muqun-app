/**
 * What is in the app's cache directory, how much room each part of it takes,
 * and -- the reason this file exists at all -- which of it Muqun is allowed to
 * delete.
 *
 * The rule is stated as an *allow-list of names* rather than as "everything
 * under the cache except the ones we know about". The two readings differ the
 * moment a dependency starts writing somewhere new: an allow-list reports the
 * unknown directory under `other` and leaves it alone, a deny-list deletes it.
 * Only the first of those is a safe thing to get wrong.
 *
 * Nothing here may name a path outside the cache root. The app's real data --
 * the MMKV stores, `theme-assets-v1`, Hot Updater's bundle store -- lives under
 * `Paths.document`, and the pairing tokens and SSH keys live in the keychain.
 * `planStorageCleanup` re-checks every entry's URI against the root rather than
 * trusting the names it was handed.
 *
 * There are no `expo-file-system` imports below. The walk is the caller's, so
 * the classification, the totals and the deletion plan are testable without a
 * device -- the only way to hold a rule whose failure mode is losing somebody's
 * servers.
 */

import { formatAssetSize } from './asset-display';

/** The three buckets the Storage section reports, in the order it shows them. */
export type CacheBucket = 'images' | 'temporary' | 'other';

/**
 * One entry under the cache root.
 *
 * `name` is the path relative to the root: a top-level child, or
 * `<container>/<child>` for the few folders the walk opens (see
 * `EXPANDED_CACHE_DIRECTORIES`). `bytes` is the whole subtree for a directory.
 */
export type CacheEntry = {
  name: string;
  /** Its absolute `file://` URI, as the filesystem reported it. */
  uri: string;
  bytes: number;
  /** Last modification, in milliseconds since the epoch. */
  modifiedAtMs: number;
};

/** The three buckets, plus the sum, in bytes. */
export type CacheTotals = {
  images: number;
  temporary: number;
  other: number;
  total: number;
};

/** Muqun's own folder of verified full-size originals; see `original-image-cache.ts`. */
export const ORIGINAL_IMAGE_CACHE_DIRECTORY = 'image-originals';

/**
 * Decoded and downloaded pictures the image libraries own, emptied only
 * through `Image.clearDiskCache()`: Glide and SDWebImage keep an open journal,
 * and a directory pulled out from under either mid-write is how a cache turns
 * into a crash.
 *
 * - `image_manager_disk_cache` is Glide's default directory, which
 *   `ExpoImageAppGlideModule.kt` puts under `context.cacheDir`.
 * - `com.hackemist.SDImageCache` is SDWebImage's default directory on iOS,
 *   under `Library/Caches` -- the directory `Paths.cache` points at.
 */
export const NATIVE_IMAGE_CACHE_DIRECTORIES = [
  'image_manager_disk_cache',
  'com.hackemist.SDImageCache',
] as const;

/**
 * Library caches that hold an open journal while the app runs and open it
 * lazily, so they can only be removed at launch, before first use.
 *
 * `enrm_image_cache` is `react-native-enriched-markdown`'s Android image cache
 * (an OkHttp cache named in `ImageDownloader.kt`), created on the first remote
 * image a Markdown view loads. See `launch-cache-purge.ts`.
 */
export const LAUNCH_PURGE_DIRECTORIES = ['enrm_image_cache'] as const;

/** The file Clear cache leaves for the next launch to find. */
export const LAUNCH_PURGE_MARKER = 'muqun-purge-at-launch';

/** What a launch purge renames a library cache to before deleting it. */
export const TRASH_PREFIX = 'muqun-trash-';

/**
 * Output folders of Expo modules, spelled the same on both platforms
 * (`ImagePicker`, `ImageManipulator`, `DocumentPicker`). Each holds a fresh
 * copy of something the reader already has. Producers hold a lease while they
 * use one (`protectCacheDirectory`), so an unleased one is free to go.
 */
export const LEASED_CACHE_DIRECTORIES = [
  'ImagePicker',
  'ImageManipulator',
  'DocumentPicker',
] as const;

/**
 * `theme-stage-<random>` is where `theme/assets.native.ts` unpacks a theme
 * before installing it into `Paths.document/theme-assets-v1`; it is leased
 * while in use, and an interrupted import leaves one behind.
 */
export const LEASED_CACHE_PREFIXES = ['theme-stage-'] as const;

/**
 * Copies nobody leases, safe once the process that made them has gone:
 *
 * - `pdf-preview-<time>-<n>.pdf`, `components/pdf-asset-preview.tsx`;
 * - `theme-export-<hex>`, `theme/local-files.ts`;
 * - `message-image-*`, written by a reader that no longer exists;
 * - `nanoicon_*.ttf`, a temporary font file `react-native-nano-icons` writes
 *   on every launch and never deletes.
 */
export const ORPHAN_CACHE_PREFIXES = [
  'pdf-preview-',
  'theme-export-',
  'message-image-',
  'nanoicon_',
] as const;

/**
 * Folders the walk opens, so their children are planned one by one: the
 * originals are trimmed oldest first, and the PDF folders hold one file per
 * rendered page or export, never the documents themselves.
 */
export const EXPANDED_CACHE_DIRECTORIES = [
  ORIGINAL_IMAGE_CACHE_DIRECTORY,
  'BetterPdf/renders',
  'BetterPdfExports',
] as const;

/**
 * Never deleted, whatever another rule says. Live engines' caches (RN's
 * OkHttp `http-cache`, Cronet's, WebView's), the PDF library's open and
 * partial downloads, and any Hot Updater name should one ever appear here.
 */
export const NEVER_DELETE_CACHE_ENTRIES = [
  'http-cache',
  'nitro_cronet_cache',
  'nitrofetch_cronet_cache',
  'WebView',
  'BetterPdf',
  'BetterPdf/session',
  'BetterPdf/partial',
  'BetterPdf/open',
  'bundle-store',
  'bundle-manifest-temp',
  LAUNCH_PURGE_MARKER,
] as const;

/** Timestamped copies owned by Muqun, never the original attachment or export. */
export function temporaryMediaCreatedAt(name: string): number | null {
  const match =
    /^(?:(?:audio-preview|video-preview)-([0-9]+)-[0-9]+\.[a-z0-9]+|dictation-([0-9]+)\.m4a|file-export-([0-9]+)-[0-9]+)$/.exec(
      name
    );
  if (!match) return null;
  const timestamp = Number(match[1] ?? match[2] ?? match[3]);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

type EntryKind =
  | 'native-images'
  | 'original'
  | 'launch-purge'
  | 'leased'
  | 'orphan'
  | 'trash'
  | 'kept';

const includes = (list: readonly string[], name: string) => list.includes(name);

/** A single path segment, or `<expanded container>/<segment>`. */
function isWellFormedName(name: string): boolean {
  if (name.includes('\\')) return false;
  const segments = name.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  if (segments.length === 1) return true;
  return includes(EXPANDED_CACHE_DIRECTORIES, segments.slice(0, -1).join('/'));
}

function kindOf(name: string): EntryKind {
  if (!isWellFormedName(name) || includes(NEVER_DELETE_CACHE_ENTRIES, name)) return 'kept';
  // An expanded folder reported whole is measured, not deleted.
  if (includes(EXPANDED_CACHE_DIRECTORIES, name)) return 'kept';
  const slash = name.lastIndexOf('/');
  if (slash >= 0) {
    return name.slice(0, slash) === ORIGINAL_IMAGE_CACHE_DIRECTORY ? 'original' : 'orphan';
  }
  if (includes(NATIVE_IMAGE_CACHE_DIRECTORIES, name)) return 'native-images';
  if (includes(LAUNCH_PURGE_DIRECTORIES, name)) return 'launch-purge';
  if (name.startsWith(TRASH_PREFIX)) return 'trash';
  if (includes(LEASED_CACHE_DIRECTORIES, name)) return 'leased';
  if (LEASED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'leased';
  if (temporaryMediaCreatedAt(name) !== null) return 'leased';
  if (ORPHAN_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'orphan';
  return 'kept';
}

function bucketOf(kind: EntryKind): CacheBucket {
  if (kind === 'native-images' || kind === 'original') return 'images';
  if (kind === 'leased' || kind === 'orphan' || kind === 'trash') return 'temporary';
  return 'other';
}

/** Which bucket one cache entry belongs to, by name alone. */
export function classifyCacheEntry(name: string): CacheBucket {
  return bucketOf(kindOf(name));
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

/** The entry's URI must be exactly the root plus its name: no aliasing. */
function isFenced(entry: CacheEntry, rootUri: string): boolean {
  if (!isInsideCacheRoot(entry.uri, rootUri)) return false;
  const root = rootUri.replace(/\/+$/, '') + '/';
  return entry.uri.replace(/\/+$/, '') === root + entry.name;
}

const sizeOf = (bytes: number) => (Number.isFinite(bytes) && bytes > 0 ? bytes : 0);

export type StorageCleanupOptions = {
  /** The cache root every planned path must sit strictly inside. */
  rootUri: string;
  nowMs: number;
  /** Unleased copies made before this belong to a process that has gone. */
  processStartedAtMs: number;
  /** Names a producer holds right now; never planned. */
  protectedNames: ReadonlySet<string> | ((name: string) => boolean);
  /**
   * Evict caches, least recently modified first, until the total fits. Zero
   * evicts everything evictable (Clear cache); omitted evicts nothing.
   */
  budgetBytes?: number;
};

export type StorageCleanupPlan = {
  /** Delete these by path, now. */
  deletions: CacheEntry[];
  /** Ask expo-image to empty Glide / SDWebImage. */
  clearNativeImages: boolean;
  /** Library caches only the next launch may remove. */
  purgeAtNextLaunch: string[];
  /** Bytes the deletions and the native clear give back now. */
  reclaimableBytes: number;
  /** Bytes the next launch gives back. */
  deferredBytes: number;
  buckets: CacheTotals;
};

/**
 * What a cleanup may remove, decided from one walk of the cache.
 *
 * Unconditionally: unleased copies (`leased` kinds no producer holds), orphans
 * older than this process, and library caches already moved aside. Then, when
 * a budget is given and the cache is still over it, whole caches in the order
 * they were last written: each original image, the image libraries' caches,
 * the Markdown cache. Every planned path is fenced inside `rootUri`.
 */
export function planStorageCleanup(
  entries: readonly CacheEntry[],
  options: StorageCleanupOptions
): StorageCleanupPlan {
  const { protectedNames, processStartedAtMs, budgetBytes } = options;
  const isProtected =
    typeof protectedNames === 'function'
      ? protectedNames
      : (name: string) => protectedNames.has(name);
  const buckets: CacheTotals = { images: 0, temporary: 0, other: 0, total: 0 };
  const deletions: CacheEntry[] = [];
  const evictable: { entry: CacheEntry; kind: EntryKind }[] = [];
  let reclaimableBytes = 0;
  let remaining = 0;

  for (const entry of entries) {
    const bytes = sizeOf(entry.bytes);
    const kind = kindOf(entry.name);
    buckets[bucketOf(kind)] += bytes;
    buckets.total += bytes;
    remaining += bytes;
    const topLevel = entry.name.split('/')[0];
    if (kind === 'kept' || !isFenced(entry, options.rootUri)) continue;
    if (isProtected(entry.name) || isProtected(topLevel)) continue;
    const createdAt = temporaryMediaCreatedAt(entry.name) ?? entry.modifiedAtMs;
    const unconditional =
      kind === 'trash' ||
      kind === 'leased' ||
      (kind === 'orphan' && Number.isFinite(createdAt) && createdAt < processStartedAtMs);
    if (unconditional) {
      deletions.push(entry);
      reclaimableBytes += bytes;
      remaining -= bytes;
    } else if (kind === 'original' || kind === 'native-images' || kind === 'launch-purge') {
      evictable.push({ entry, kind });
    }
  }

  let clearNativeImages = false;
  const purgeAtNextLaunch: string[] = [];
  let deferredBytes = 0;
  if (budgetBytes !== undefined) {
    const oldestFirst = [...evictable].sort((a, b) => {
      const age = (entry: CacheEntry) =>
        Number.isFinite(entry.modifiedAtMs) ? Math.min(entry.modifiedAtMs, options.nowMs) : 0;
      return age(a.entry) - age(b.entry);
    });
    for (const { entry, kind } of oldestFirst) {
      if (remaining <= budgetBytes) break;
      const bytes = sizeOf(entry.bytes);
      remaining -= bytes;
      if (kind === 'launch-purge') {
        purgeAtNextLaunch.push(entry.name);
        deferredBytes += bytes;
        continue;
      }
      if (kind === 'native-images') clearNativeImages = true;
      else deletions.push(entry);
      reclaimableBytes += bytes;
    }
  }

  return {
    deletions,
    clearNativeImages,
    purgeAtNextLaunch,
    reclaimableBytes,
    deferredBytes,
    buckets,
  };
}

/**
 * Least recently written first, the files to delete so the rest fit `capBytes`.
 * Unknown or negative sizes count as zero rather than as room given back.
 */
export function planLruTrim(
  files: readonly { name: string; bytes: number; modifiedAtMs: number }[],
  capBytes: number
): string[] {
  let total = files.reduce((sum, file) => sum + sizeOf(file.bytes), 0);
  const doomed: string[] = [];
  for (const file of [...files].sort((a, b) => a.modifiedAtMs - b.modifiedAtMs)) {
    if (total <= capBytes) break;
    doomed.push(file.name);
    total -= sizeOf(file.bytes);
  }
  return doomed;
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
