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
  const protectedDirectories = new Map<string, number>();
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
      protectedDirectories.set(name, (protectedDirectories.get(name) ?? 0) + 1);
      await flight;
    },
    release: (name: string) => {
      const count = protectedDirectories.get(name) ?? 0;
      if (count > 1) protectedDirectories.set(name, count - 1);
      else protectedDirectories.delete(name);
    },
    isProtected: (name: string) => protectedDirectories.has(name),
  };
}

/** A failed native deletion must relinquish ownership so cleanup can retry. */
export function createCacheEntryDisposer(remove: () => void, release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      remove();
    } catch {
      // The now-idle entry remains eligible for the next cleanup.
    } finally {
      release();
    }
  };
}

/** Order native cache mutations; a cleared/changed connection rejects late writes. */
export function createCacheMutationQueue() {
  let epoch = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };
  return {
    epoch: () => epoch,
    invalidate: () => {
      epoch++;
    },
    write: (expected: number, write: () => Promise<void>) =>
      run(async () => {
        if (expected === epoch) await write();
      }),
    clear: (clear: () => Promise<boolean>) => {
      epoch++;
      return run(clear);
    },
  };
}
