/**
 * A cache of expensive, disposable values -- decoded images -- shared by every
 * caller asking for the same key, and released only once nobody holds them.
 *
 * Free of React and Skia so `bun test` can load it; `skia-image-cache.ts` is
 * the Skia loader and hook built on it.
 *
 * - **One load per key.** Every `acquire` of a key while it is cached gets the
 *   same promise, and so the same value.
 * - **Never released under a holder.** Each `acquire` returns a `release`; a
 *   value is a candidate for disposal only once every holder has released it.
 * - **A short grace period, not a pool.** A value nobody holds is disposed
 *   `graceMs` later unless somebody takes it again first -- enough for a
 *   picture handed from one screen to the next (the launch opening to Home) or
 *   a component remounting, and short enough that a theme's pictures are gone
 *   within a second of a new theme replacing them.
 * - **Failures are not cached.** A load that rejects or yields nothing is
 *   forgotten, so the next caller tries again.
 */

export type CacheHandle<T> = {
  /** Resolves to the value, or null when it could not be loaded. */
  promise: Promise<T | null>;
  /** Give the value back. Idempotent. */
  release: () => void;
};

type Entry<T> = {
  promise: Promise<T | null>;
  value: T | null;
  refs: number;
  /** Disposed or forgotten: a late resolution must dispose what it brings. */
  dead: boolean;
  cancelDisposal: (() => void) | null;
};

export type RefCountedCache<T> = {
  acquire: (key: string) => CacheHandle<T>;
  /** The value if it is already loaded, without taking a hold on it. */
  peek: (key: string) => T | null;
  /** Keys currently cached, held or in their grace period. */
  keys: () => string[];
};

/** Run `run` after `ms`; returns a cancel. */
export type Schedule = (run: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export function createRefCountedCache<T>({
  load,
  dispose,
  graceMs = 1000,
  schedule = defaultSchedule,
}: {
  load: (key: string) => Promise<T | null>;
  dispose: (value: T) => void;
  graceMs?: number;
  schedule?: Schedule;
}): RefCountedCache<T> {
  const entries = new Map<string, Entry<T>>();

  const forget = (key: string, entry: Entry<T>) => {
    entry.dead = true;
    if (entries.get(key) === entry) entries.delete(key);
    if (entry.value !== null) dispose(entry.value);
    entry.value = null;
  };

  const acquire = (key: string): CacheHandle<T> => {
    let entry = entries.get(key);
    if (!entry) {
      const created: Entry<T> = {
        promise: Promise.resolve(null),
        value: null,
        refs: 0,
        dead: false,
        cancelDisposal: null,
      };
      created.promise = load(key).then(
        (value) => {
          if (created.dead) {
            if (value !== null) dispose(value);
            return null;
          }
          if (value === null) {
            if (entries.get(key) === created) entries.delete(key);
            return null;
          }
          created.value = value;
          return value;
        },
        () => {
          if (entries.get(key) === created) entries.delete(key);
          return null;
        }
      );
      entries.set(key, created);
      entry = created;
    }
    const held = entry;
    held.refs += 1;
    held.cancelDisposal?.();
    held.cancelDisposal = null;
    let released = false;
    return {
      promise: held.promise,
      release: () => {
        if (released) return;
        released = true;
        held.refs -= 1;
        if (held.refs > 0 || held.dead) return;
        held.cancelDisposal = schedule(() => {
          held.cancelDisposal = null;
          if (held.refs === 0) forget(key, held);
        }, graceMs);
      },
    };
  };

  return {
    acquire,
    peek: (key) => entries.get(key)?.value ?? null,
    keys: () => [...entries.keys()],
  };
}
