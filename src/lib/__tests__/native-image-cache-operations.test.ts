import { expect, test } from 'bun:test';
import { createCacheMutationQueue } from '../cache-cleanup-policy';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('native clear waits for an active seed and rejects queued stale writes', async () => {
  const cache = createCacheMutationQueue();
  const gate = deferred();
  const events: string[] = [];
  const epoch = cache.epoch();
  const first = cache.write(epoch, async () => {
    events.push('seed-start');
    await gate.promise;
    events.push('seed-end');
  });
  await Promise.resolve();
  const stale = cache.write(epoch, async () => {
    events.push('stale-seed');
  });
  const clear = cache.clear(async () => {
    events.push('clear');
    return true;
  });
  gate.release();
  await Promise.all([first, stale, clear]);
  expect(events).toEqual(['seed-start', 'seed-end', 'clear']);
});

test('download completion after clear cannot reseed old data', async () => {
  const cache = createCacheMutationQueue();
  const epoch = cache.epoch();
  await cache.clear(async () => true);
  let written = false;
  await cache.write(epoch, async () => {
    written = true;
  });
  expect(written).toBe(false);
});

test('connection invalidation skips a queued seed without clearing unrelated native images', async () => {
  const cache = createCacheMutationQueue();
  let written = false;
  const seed = cache.write(cache.epoch(), async () => {
    written = true;
  });
  cache.invalidate();
  await seed;
  expect(written).toBe(false);
});

test('a failed native write does not block subsequent clear and new writes', async () => {
  const cache = createCacheMutationQueue();
  await expect(
    cache.write(cache.epoch(), async () => {
      throw new Error('disk full');
    })
  ).rejects.toThrow('disk full');
  expect(await cache.clear(async () => true)).toBe(true);
  let written = false;
  await cache.write(cache.epoch(), async () => {
    written = true;
  });
  expect(written).toBe(true);
});
