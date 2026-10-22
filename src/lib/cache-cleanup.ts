import { nativeImageCache } from './native-image-cache';
import { originalImageCache } from './original-image-cache';
import { cacheDirectory, deleteAsync, readDirectoryAsync } from 'expo-file-system/legacy';
import { AppState } from 'react-native';
import {
  cacheCleanupIsDue,
  createCacheCleanupFlight,
  createCacheEntryDisposer,
} from '@/lib/cache-cleanup-policy';
import { useAppSettings } from '@/stores/app-settings';
import {
  LAUNCH_PURGE_DIRECTORIES,
  TRASH_PREFIX,
  planCacheDeletions,
  temporaryMediaCreatedAt,
} from '@/lib/cache-storage';
import { requestLaunchCachePurge } from '@/lib/launch-cache-purge';

// Imported by RootLayout before any user interaction can create a media copy.
// Startup recovery only removes previous-process copies; normal cleanup uses live leases.
export const CACHE_PROCESS_STARTED_AT = Date.now();

/** Recover media copies left behind when the previous process was killed, and
 * delete library caches a launch purge moved aside. */
export async function cleanupPreviousMediaCache(): Promise<void> {
  try {
    const root = cacheDirectory;
    if (!root) return;
    // Startup shares the asynchronous native IO path with manual cleanup.
    // Wrapping Directory.list/delete in an async function still blocks JS.
    const names = (await readDirectoryAsync(root)).filter(
      (name) => temporaryMediaCreatedAt(name) !== null || name.startsWith(TRASH_PREFIX)
    );
    const plan = planCacheDeletions(
      names.map((name) => ({ name, uri: root + name, bytes: 0 })),
      root,
      CACHE_PROCESS_STARTED_AT
    );
    for (const entry of plan) {
      try {
        await deleteAsync(entry.uri, { idempotent: true });
      } catch {
        // A locked file is retried by Clear cache or on the next launch.
      }
    }
  } catch {
    // Cache access is optional; it must never block launch or sign-in.
  }
}

/**
 * The Storage button and automatic cleanup share this operation. Use the legacy
 * native async API here: Directory.delete() is synchronous even in an async
 * function, and recursive deletion must not occupy the JavaScript thread.
 * Capacity measurement remains a separate, user-visible Storage concern.
 */
export function clearCache(shouldContinue: () => boolean = () => true): Promise<boolean> {
  return cleanupFlight.run(async () => {
    try {
      if (!shouldContinue()) return false;
      let succeeded = true;
      try {
        if (!(await nativeImageCache.clear())) succeeded = false;
      } catch {
        succeeded = false;
      }
      try {
        await originalImageCache.clear();
      } catch {
        succeeded = false;
      }
      if (!shouldContinue()) return false;
      const root = cacheDirectory;
      if (!root) return false;
      const names = await readDirectoryAsync(root);
      // The Markdown image cache has no clear API and an open journal; the next
      // launch removes it before anything opens it.
      if (names.some((name) => (LAUNCH_PURGE_DIRECTORIES as readonly string[]).includes(name))) {
        requestLaunchCachePurge();
      }
      const entries = names.map((name) => ({ name, uri: root + name, bytes: 0 }));
      // Live producers hold leases; abandoned copies from this process are safe too.
      for (const entry of planCacheDeletions(entries, root, Number.MAX_SAFE_INTEGER)) {
        if (!shouldContinue()) return false;
        if (cleanupFlight.isProtected(entry.name)) continue;
        try {
          await deleteAsync(entry.uri, { idempotent: true });
        } catch {
          succeeded = false;
        }
      }
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

export const isCacheEntryProtected = cleanupFlight.isProtected;

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
