import { nativeImageCache } from './native-image-cache';
import { originalImageCache } from './original-image-cache';
import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import { AppState } from 'react-native';
import {
  cacheCleanupIsDue,
  createCacheCleanupFlight,
  createCacheEntryDisposer,
} from '@/lib/cache-cleanup-policy';
import { useAppSettings } from '@/stores/app-settings';
import {
  EXPANDED_CACHE_DIRECTORIES,
  planStorageCleanup,
  type CacheEntry,
  type StorageCleanupPlan,
} from '@/lib/cache-storage';
import { requestLaunchCachePurge } from '@/lib/launch-cache-purge';

// Imported by RootLayout before any user interaction can create a media copy.
// Unleased copies older than this belong to a process that has gone.
export const CACHE_PROCESS_STARTED_AT = Date.now();

/** The launch sweep evicts caches, oldest first, until the rest fits in this. */
export const CACHE_BUDGET_BYTES = 150 * 1024 * 1024;

async function entryAt(name: string, uri: string): Promise<CacheEntry | null> {
  const info = await getInfoAsync(uri);
  if (!info.exists) return null;
  return { name, uri, bytes: info.size, modifiedAtMs: info.modificationTime * 1000 };
}

/**
 * One walk of the cache, through the legacy async API so the recursive sizes
 * are computed off the JavaScript thread. Folders the planner trims one file
 * at a time are opened; a folder that only contains one of them (`BetterPdf`)
 * is opened one level so nothing is counted twice.
 */
export async function readCacheEntries(
  root: string,
  shouldContinue: () => boolean = () => true
): Promise<CacheEntry[]> {
  const entries: CacheEntry[] = [];
  const visit = async (name: string): Promise<void> => {
    if (!shouldContinue()) return;
    const uri = root + name;
    const expanded = (EXPANDED_CACHE_DIRECTORIES as readonly string[]).includes(name);
    const contains = EXPANDED_CACHE_DIRECTORIES.some((path) => path.startsWith(`${name}/`));
    if (expanded || contains) {
      let children: string[];
      try {
        children = await readDirectoryAsync(uri);
      } catch {
        children = [];
      }
      for (const child of children) await visit(`${name}/${child}`);
      return;
    }
    try {
      const entry = await entryAt(name, uri);
      if (entry) entries.push(entry);
    } catch {
      // An entry the OS will not measure is worth nothing to the total.
    }
  };
  for (const name of await readDirectoryAsync(root)) await visit(name);
  return entries;
}

/** Measure and plan without deleting anything: what Storage shows. Null when
 * the cache cannot be read. */
export async function inspectCache(): Promise<StorageCleanupPlan | null> {
  const root = cacheDirectory;
  if (!root) return null;
  try {
    return planStorageCleanup(await readCacheEntries(root), {
      rootUri: root,
      nowMs: Date.now(),
      processStartedAtMs: CACHE_PROCESS_STARTED_AT,
      protectedNames: cleanupFlight.isProtected,
      budgetBytes: 0,
    });
  } catch {
    return null;
  }
}

/** Carry out a plan; false when anything could not be removed. */
async function executePlan(
  root: string,
  budgetBytes: number,
  shouldContinue: () => boolean
): Promise<boolean> {
  const entries = await readCacheEntries(root, shouldContinue);
  if (!shouldContinue()) return false;
  const plan = planStorageCleanup(entries, {
    rootUri: root,
    nowMs: Date.now(),
    processStartedAtMs: CACHE_PROCESS_STARTED_AT,
    protectedNames: cleanupFlight.isProtected,
    budgetBytes,
  });
  let succeeded = true;
  if (plan.clearNativeImages) {
    try {
      if (!(await nativeImageCache.clear())) succeeded = false;
    } catch {
      succeeded = false;
    }
  }
  for (const entry of plan.deletions) {
    if (!shouldContinue()) return false;
    // A producer may have taken a lease since the walk.
    if (cleanupFlight.isProtected(entry.name.split('/')[0])) continue;
    try {
      await deleteAsync(entry.uri, { idempotent: true });
    } catch {
      succeeded = false;
    }
  }
  if (plan.purgeAtNextLaunch.length > 0) requestLaunchCachePurge();
  return succeeded;
}

/**
 * Once per launch, off the first frames: remove copies the previous process
 * left behind, library caches a launch purge moved aside, and -- when the
 * cache is over budget -- the least recently written caches until it fits.
 */
export function sweepCacheAtLaunch(): Promise<boolean> {
  return cleanupFlight.run(async () => {
    try {
      const root = cacheDirectory;
      if (!root) return false;
      return await executePlan(root, CACHE_BUDGET_BYTES, () => true);
    } catch {
      // Cache access is optional; it must never block launch or sign-in.
      return false;
    }
  });
}

/**
 * The Storage button and automatic cleanup share this operation: everything
 * the planner may remove, with a zero budget. The legacy native async API is
 * used throughout: Directory.delete() is synchronous even in an async
 * function, and recursive deletion must not occupy the JavaScript thread.
 */
export function clearCache(shouldContinue: () => boolean = () => true): Promise<boolean> {
  return cleanupFlight.run(async () => {
    try {
      if (!shouldContinue()) return false;
      let succeeded = true;
      try {
        // Ordered after any in-flight seed, and rejects seeds from before it.
        await originalImageCache.clear();
      } catch {
        succeeded = false;
      }
      const root = cacheDirectory;
      if (!root || !shouldContinue()) return false;
      if (!(await executePlan(root, 0, shouldContinue))) succeeded = false;
      if (!shouldContinue()) return false;
      if (succeeded) {
        await useAppSettings.getState().update({ cacheCleanupLastSuccessAt: Date.now() });
      }
      return succeeded;
    } catch {
      return false;
    }
  });
}

const cleanupFlight = createCacheCleanupFlight();

/** Mark before producing files, then wait out any already-started deletion. */
export async function protectCacheDirectory(name: string): Promise<void> {
  await cleanupFlight.protect(name);
}

/** Theme stages release protection only after their own disposal finishes. */
export function releaseCacheDirectory(name: string): void {
  cleanupFlight.release(name);
}

/** Acquire before creating a media copy. Disposal always relinquishes ownership,
 * including when deletion fails so a later Clear cache can retry the file. */
export async function protectTemporaryCacheEntry(entry: {
  name: string;
  readonly exists: boolean;
  delete(): void;
}): Promise<() => void> {
  await protectCacheDirectory(entry.name);
  return createCacheEntryDisposer(
    () => {
      if (entry.exists) entry.delete();
    },
    () => releaseCacheDirectory(entry.name)
  );
}

export function automaticCacheCleanupIsDue(): boolean {
  const settings = useAppSettings.getState();
  return (
    settings.hydrated &&
    cacheCleanupIsDue(
      settings.cacheCleanupIntervalDays,
      settings.cacheCleanupEnabledAt,
      settings.cacheCleanupLastSuccessAt,
      Date.now()
    )
  );
}

/** One idle opportunity per opening. No filesystem work or timer before due. */
export function scheduleAutomaticCacheCleanup(onCleaned?: () => void, delayMs = 0): () => void {
  if (!automaticCacheCleanupIsDue() || AppState.currentState !== 'active') return () => {};
  let cancelled = false;
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') cancel();
  });
  let handle: number | undefined;
  const start = () => {
    handle = requestIdleCallback(() => {
      if (cancelled || !automaticCacheCleanupIsDue()) {
        subscription.remove();
        return;
      }
      void clearCache(
        () => !cancelled && AppState.currentState === 'active' && automaticCacheCleanupIsDue()
      ).then((succeeded) => {
        if (succeeded && !cancelled) onCleaned?.();
        subscription.remove();
      });
    });
  };
  const timer = delayMs > 0 ? setTimeout(start, delayMs) : undefined;
  if (!timer) start();
  function cancel() {
    cancelled = true;
    if (handle !== undefined) cancelIdleCallback(handle);
    if (timer !== undefined) clearTimeout(timer);
    subscription.remove();
  }
  return cancel;
}
