import { describe, expect, test } from 'bun:test';

import { createRefCountedCache } from '../ref-counted-cache';

type Value = { key: string; disposed: boolean };

/** A cache whose grace timers run only when the test says so. */
function harness() {
  const loads: string[] = [];
  const disposed: string[] = [];
  const pending = new Map<string, (value: Value | null) => void>();
  let timers: { run: () => void; cancelled: boolean }[] = [];
  const cache = createRefCountedCache<Value>({
    load: (key) => {
      loads.push(key);
      return new Promise((resolve) => pending.set(key, resolve));
    },
    dispose: (value) => {
      value.disposed = true;
      disposed.push(value.key);
    },
    schedule: (run) => {
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const resolve = async (key: string, value: Value | null = { key, disposed: false }) => {
    pending.get(key)?.(value);
    pending.delete(key);
    await Promise.resolve();
    await Promise.resolve();
    return value;
  };
  const elapse = () => {
    const due = timers;
    timers = [];
    for (const timer of due) if (!timer.cancelled) timer.run();
  };
  return { cache, loads, disposed, resolve, elapse };
}

describe('createRefCountedCache', () => {
  test('one load and the same promise for every caller of a key', async () => {
    const { cache, loads, resolve } = harness();
    const a = cache.acquire('hero');
    const b = cache.acquire('hero');
    expect(a.promise).toBe(b.promise);
    expect(loads).toEqual(['hero']);
    const value = await resolve('hero');
    expect(await a.promise).toBe(value);
    expect(await b.promise).toBe(value);
    expect(cache.peek('hero')).toBe(value);
  });

  test('never disposes a value somebody still holds', async () => {
    const { cache, disposed, resolve, elapse } = harness();
    const a = cache.acquire('hero');
    const b = cache.acquire('hero');
    await resolve('hero');
    a.release();
    a.release(); // idempotent
    elapse();
    expect(disposed).toEqual([]);
    expect(cache.peek('hero')).not.toBeNull();
    b.release();
    elapse();
    expect(disposed).toEqual(['hero']);
    expect(cache.peek('hero')).toBeNull();
  });

  test('a hand-over inside the grace period reuses the value', async () => {
    const { cache, loads, disposed, resolve, elapse } = harness();
    const opening = cache.acquire('hero');
    const value = await resolve('hero');
    opening.release();
    const home = cache.acquire('hero');
    elapse();
    expect(loads).toEqual(['hero']);
    expect(await home.promise).toBe(value);
    expect(disposed).toEqual([]);
  });

  test("a replaced theme's pictures are released once the grace period ends", async () => {
    const { cache, disposed, resolve, elapse } = harness();
    const old = cache.acquire('old-hero');
    await resolve('old-hero');
    const next = cache.acquire('new-hero');
    await resolve('new-hero');
    old.release();
    expect(disposed).toEqual([]);
    elapse();
    expect(disposed).toEqual(['old-hero']);
    expect(cache.keys()).toEqual(['new-hero']);
    next.release();
  });

  test('a load that fails is not cached', async () => {
    const { cache, loads, resolve } = harness();
    const first = cache.acquire('broken');
    await resolve('broken', null);
    expect(await first.promise).toBeNull();
    first.release();
    cache.acquire('broken');
    expect(loads).toEqual(['broken', 'broken']);
  });

  test('a value that arrives after it was let go is disposed, not leaked', async () => {
    const { cache, disposed, resolve, elapse } = harness();
    const handle = cache.acquire('slow');
    handle.release();
    elapse();
    const value = await resolve('slow');
    expect(value?.disposed).toBe(true);
    expect(disposed).toEqual(['slow']);
    expect(cache.peek('slow')).toBeNull();
  });
});
