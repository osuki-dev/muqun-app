import { expect, test } from 'bun:test';
import { createCacheCleanupFlight, createCacheEntryDisposer } from '../cache-cleanup-policy';
import { planCacheDeletions } from '../cache-storage';

const root = 'file:///cache/';
const entry = (name: string) => ({ name, uri: root + name, bytes: 100 });

test('idle current-process media is reclaimable while active media and theme stages are protected', async () => {
  const flight = createCacheCleanupFlight();
  const active = 'file-export-200-1';
  await flight.protect(active);
  await flight.protect('theme-stage-active');
  const entries = [
    entry(active),
    entry('file-export-201-2'),
    entry('audio-preview-202-1.mp3'),
    entry('theme-stage-active'),
    entry('theme-stage-abandoned'),
    entry('unknown'),
    { ...entry('ImagePicker'), uri: 'file:///documents/ImagePicker' },
  ];
  const deleted: string[] = [];
  await flight.run(async () => {
    for (const item of planCacheDeletions(entries, root, Number.MAX_SAFE_INTEGER)) {
      if (!flight.isProtected(item.name)) deleted.push(item.name);
    }
    return true;
  });
  expect(deleted).toEqual([
    'file-export-201-2',
    'audio-preview-202-1.mp3',
    'theme-stage-abandoned',
  ]);
});

test('producer waits for an already-started deletion before creating a replacement', async () => {
  const flight = createCacheCleanupFlight();
  const events: string[] = [];
  let finish!: () => void;
  const deleting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cleanup = flight.run(async () => {
    events.push('delete-start');
    await deleting;
    events.push('delete-end');
    return true;
  });
  const producer = flight.protect('file-export-200-1').then(() => {
    events.push('create');
  });
  expect(flight.isProtected('file-export-200-1')).toBe(true);
  await Promise.resolve();
  expect(events).toEqual(['delete-start']);
  finish();
  await Promise.all([cleanup, producer]);
  expect(events).toEqual(['delete-start', 'delete-end', 'create']);
});

test('cancel during a pending cleanup relinquishes the lease after protection settles', async () => {
  const flight = createCacheCleanupFlight();
  let finish!: () => void;
  const cleanup = flight.run(
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  let cancelled = false;
  let created = false;
  const preparation = (async () => {
    await flight.protect('dictation-200.m4a');
    const dispose = createCacheEntryDisposer(
      () => {},
      () => flight.release('dictation-200.m4a')
    );
    try {
      if (cancelled) throw new Error('cancelled');
      created = true;
    } finally {
      dispose();
    }
  })();
  cancelled = true;
  finish();
  await cleanup;
  await expect(preparation).rejects.toThrow('cancelled');
  expect(created).toBe(false);
  expect(flight.isProtected('dictation-200.m4a')).toBe(false);
});

test('failed deletion releases once and does not release another owner of the same name', async () => {
  const flight = createCacheCleanupFlight();
  await flight.protect('dictation-200.m4a');
  await flight.protect('dictation-200.m4a');
  let attempts = 0;
  const dispose = createCacheEntryDisposer(
    () => {
      attempts++;
      throw new Error('busy');
    },
    () => flight.release('dictation-200.m4a')
  );
  dispose();
  dispose();
  expect(attempts).toBe(1);
  expect(flight.isProtected('dictation-200.m4a')).toBe(true);
  flight.release('dictation-200.m4a');
  expect(flight.isProtected('dictation-200.m4a')).toBe(false);
});

test('clearable bytes exclude active copies and library-managed images without hiding totals', async () => {
  const { clearableCacheBytes, measureCache } = await import('../cache-storage');
  const entries = [
    entry('file-export-200-1'),
    entry('file-export-200-2'),
    entry('image_manager_disk_cache'),
    entry('enrm_image_cache'),
    entry('unknown'),
  ];
  expect(measureCache(entries)).toEqual({ images: 200, temporary: 200, other: 100, total: 500 });
  expect(clearableCacheBytes(entries, root, (name) => name === 'file-export-200-1')).toBe(200);
});
