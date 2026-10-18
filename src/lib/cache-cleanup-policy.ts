/** Automatic cleanup is opt-in; intervals are elapsed days, not file ages. */
export type CacheCleanupIntervalDays = 0 | 10 | 30;

export function isCacheCleanupIntervalDays(value: unknown): value is CacheCleanupIntervalDays {
  return value === 0 || value === 10 || value === 30;
}

export function isCacheCleanupTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function cacheCleanupIsDue(
  intervalDays: CacheCleanupIntervalDays,
  enabledAt: number,
  lastSuccessAt: number,
  now: number
): boolean {
  const baseline = Math.max(enabledAt, lastSuccessAt);
  return intervalDays > 0 && baseline > 0 && now - baseline >= intervalDays * 86_400_000;
}

/** Manual callers join the same operation; automatic callers never start a second one. */
export function createCacheCleanupFlight() {
  let flight: Promise<boolean> | null = null;
  const protectedDirectories = new Set<string>();
  const run = (clean: () => Promise<boolean>): Promise<boolean> => {
    if (flight) return flight;
    flight = clean().finally(() => {
      flight = null;
    });
    return flight;
  };
  return {
    run,
    async protect(name: string): Promise<void> {
      protectedDirectories.add(name);
      await flight;
    },
    release: (name: string) => protectedDirectories.delete(name),
    isProtected: (name: string) => protectedDirectories.has(name),
  };
}
