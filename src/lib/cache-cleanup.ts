import { Paths } from 'expo-file-system';
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
