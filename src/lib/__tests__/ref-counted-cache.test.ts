import { expect, test } from 'bun:test';
import { createRefCountedCache, type Schedule } from '../ref-counted-cache';

function fixture() {
  const disposal = new Set<() => void>();
  const schedule: Schedule = (run) => {
    disposal.add(run);
    return () => disposal.delete(run);
  };
  let generation = 0;
  const cache = createRefCountedCache({
    load: async (key: string) => ({ key, generation: ++generation, disposed: false }),
    dispose: (resource) => {
      resource.disposed = true;
    },
    schedule,
  });
  return {
    cache,
    expire: () => {
      for (const run of [...disposal]) {
        disposal.delete(run);
        run();
      }
    },
  };
}

test('A to B to A never exposes an old disposed image or texture through its released lease', async () => {
  const { cache, expire } = fixture();
  const first = cache.acquire('A');
  const original = await first.promise;
  expect(first.current()).toBe(original);
  first.release();
  expect(first.current()).toBeNull();
  const other = cache.acquire('B');
  await other.promise;
  expire();
  expect(original?.disposed).toBe(true);
  const next = cache.acquire('A');
  expect(next.current()).toBeNull();
  expect(first.current()).toBeNull();
  const replacement = await next.promise;
  expect(next.current()).toBe(replacement);
  expect(replacement?.disposed).toBe(false);
  expect(replacement === original).toBe(false);
  other.release();
  next.release();
  expire();
});

test('hiding then restoring a picture during grace requires a fresh lease even if pixels are shared', async () => {
  const { cache, expire } = fixture();
  const hidden = cache.acquire('A');
  const image = await hidden.promise;
  hidden.release();
  expect(hidden.current()).toBeNull();
  const shown = cache.acquire('A');
  expect(await shown.promise).toBe(image);
  expire();
  expect(image?.disposed).toBe(false);
  expect(shown.current()).toBe(image);
  expect(hidden.current()).toBeNull();
  shown.release();
  expire();
  expect(image?.disposed).toBe(true);
  const restored = cache.acquire('A');
  expect(restored.current()).toBeNull();
  expect(shown.current()).toBeNull();
  expect((await restored.promise) === image).toBe(false);
  expect(restored.current()?.disposed).toBe(false);
  restored.release();
  expire();
});

test('a decode that completes after its lease expired is disposed and cannot revive the old lease', async () => {
  let finish!: (value: { disposed: boolean }) => void;
  let expire!: () => void;
  const image = { disposed: false };
  const cache = createRefCountedCache({
    load: () =>
      new Promise<typeof image>((resolve) => {
        finish = resolve;
      }),
    dispose: (value) => {
      value.disposed = true;
    },
    schedule: (run) => {
      expire = run;
      return () => undefined;
    },
  });
  const lease = cache.acquire('A');
  lease.release();
  expire();
  finish(image);
  expect(await lease.promise).toBeNull();
  expect(lease.current()).toBeNull();
  expect(image.disposed).toBe(true);
  expect(cache.peek('A')).toBeNull();
});
