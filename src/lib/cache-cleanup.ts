import { Paths } from 'expo-file-system';
import { cacheDirectory, deleteAsync, readDirectoryAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { AppState } from 'react-native';
import { cacheCleanupIsDue, createCacheCleanupFlight } from '@/lib/cache-cleanup-policy';
import { useAppSettings } from '@/stores/app-settings';
import { planCacheDeletions, temporaryMediaCreatedAt } from '@/lib/cache-storage';

// Imported by RootLayout before any user interaction can create a media copy.
// Keep every file from this process, including paused players and active exports.
export const CACHE_PROCESS_STARTED_AT = Date.now();

/** Recover media copies left behind when the previous process was killed. */
export async function cleanupPreviousMediaCache(): Promise<void> {
  try {
    const root = Paths.cache;
    const items = root.list().filter((item) => temporaryMediaCreatedAt(item.name) !== null);
    const plan = planCacheDeletions(
      items.map((item) => ({ name: item.name, uri: item.uri, bytes: 0 })),
      root.uri,
      CACHE_PROCESS_STARTED_AT
    );
    const allowed = new Set(plan.map((item) => item.uri));
    for (const item of items) {
      if (!allowed.has(item.uri)) continue;
      await new Promise<void>((resolve) => requestIdleCallback(() => resolve(), { timeout: 100 }));
      try {
        if (item.exists) item.delete();
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
        if (!(await Image.clearDiskCache())) succeeded = false;
      } catch {
        succeeded = false;
      }
      if (!shouldContinue()) return false;
      const root = cacheDirectory;
      if (!root) return false;
      const names = await readDirectoryAsync(root);
      const entries = names.map((name) => ({ name, uri: root + name, bytes: 0 }));
      for (const entry of planCacheDeletions(entries, root, CACHE_PROCESS_STARTED_AT)) {
        if (!shouldContinue()) return false;
        if (cleanupFlight.isProtected(entry.name)) continue;
        // This downloader has no library-owned clear API or active-write guard.
        if (entry.name === 'enrm_image_cache') continue;
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

/** Mark before producing files, then wait out any already-started deletion. */
export async function protectCacheDirectory(name: string): Promise<void> {
  await cleanupFlight.protect(name);
}

/** Theme stages release protection only after their own disposal finishes. */
export function releaseCacheDirectory(name: string): void {
  cleanupFlight.release(name);
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
