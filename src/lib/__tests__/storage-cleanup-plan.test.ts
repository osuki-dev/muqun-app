import { describe, expect, test } from 'bun:test';
import { planLruTrim, planStorageCleanup, type CacheEntry } from '../cache-storage';

const root = 'file:///data/app/cache/';
const MB = 1024 * 1024;
const entry = (name: string, bytes = MB, modifiedAtMs = 1_000): CacheEntry => ({
  name,
  uri: root + name,
  bytes,
  modifiedAtMs,
});
const options = {
  rootUri: root,
  nowMs: 10_000,
  processStartedAtMs: 5_000,
  protectedNames: new Set<string>(),
};
const names = (entries: readonly CacheEntry[]) => entries.map((item) => item.name).sort();

describe('planStorageCleanup allow-list', () => {
  test('removes unleased copies, old orphans and moved-aside caches, and nothing unknown', () => {
    const plan = planStorageCleanup(
      [
        entry('ImagePicker'),
        entry('theme-stage-abc'),
        entry('file-export-4000-1'),
        entry('pdf-preview-4000-0.pdf', MB, 4_000),
        entry('theme-export-0a1b', MB, 4_000),
        entry('nanoicon_123.ttf', MB, 4_000),
        entry('BetterPdf/renders/page.png', MB, 4_000),
        entry('BetterPdfExports/x', MB, 4_000),
        entry('muqun-trash-1-enrm_image_cache', MB, 9_000),
        entry('some-library-cache'),
        entry('image_manager_disk_cache'),
        entry('image-originals/abc'),
        entry('enrm_image_cache'),
      ],
      options
    );
    expect(names(plan.deletions)).toEqual([
      'BetterPdf/renders/page.png',
      'BetterPdfExports/x',
      'ImagePicker',
      'file-export-4000-1',
      'muqun-trash-1-enrm_image_cache',
      'nanoicon_123.ttf',
      'pdf-preview-4000-0.pdf',
      'theme-export-0a1b',
      'theme-stage-abc',
    ]);
    // No budget: caches are measured, not evicted.
    expect(plan.clearNativeImages).toBe(false);
    expect(plan.purgeAtNextLaunch).toEqual([]);
    expect(plan.reclaimableBytes).toBe(9 * MB);
    expect(plan.buckets).toEqual({
      images: 2 * MB,
      temporary: 9 * MB,
      other: 2 * MB,
      total: 13 * MB,
    });
  });

  test('keeps orphans written by this process and anything a producer holds', () => {
    const plan = planStorageCleanup(
      [
        entry('pdf-preview-6000-0.pdf', MB, 6_000),
        entry('theme-export-ff', MB, 6_000),
        entry('BetterPdf/renders/live.png', MB, 6_000),
        entry('DocumentPicker'),
        entry('theme-stage-live'),
      ],
      { ...options, protectedNames: new Set(['DocumentPicker', 'theme-stage-live']) }
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.reclaimableBytes).toBe(0);
  });

  test('Clear (zero budget) empties every cache, deferring the Markdown cache to launch', () => {
    const plan = planStorageCleanup(
      [
        entry('image_manager_disk_cache', 80 * MB),
        entry('image-originals/a', 10 * MB),
        entry('image-originals/b.part', 2 * MB),
        entry('enrm_image_cache', 30 * MB),
        entry('http-cache', 5 * MB),
      ],
      { ...options, budgetBytes: 0 }
    );
    expect(plan.clearNativeImages).toBe(true);
    expect(names(plan.deletions)).toEqual(['image-originals/a', 'image-originals/b.part']);
    expect(plan.purgeAtNextLaunch).toEqual(['enrm_image_cache']);
    expect(plan.reclaimableBytes).toBe(92 * MB);
    expect(plan.deferredBytes).toBe(30 * MB);
  });

  test('a budget evicts the least recently written caches until the rest fits', () => {
    const plan = planStorageCleanup(
      [
        entry('image-originals/old', 20 * MB, 1_000),
        entry('enrm_image_cache', 30 * MB, 2_000),
        entry('image-originals/new', 20 * MB, 8_000),
        entry('image_manager_disk_cache', 90 * MB, 9_000),
        entry('nitrofetch_cronet_cache', 40 * MB, 500),
      ],
      { ...options, budgetBytes: 150 * MB }
    );
    // 200 MB total: the two oldest evictable caches bring it to 150 MB.
    expect(names(plan.deletions)).toEqual(['image-originals/old']);
    expect(plan.purgeAtNextLaunch).toEqual(['enrm_image_cache']);
    expect(plan.clearNativeImages).toBe(false);
  });

  test('a cache under budget is left alone', () => {
    const plan = planStorageCleanup(
      [entry('image_manager_disk_cache', 90 * MB), entry('image-originals/a', 10 * MB)],
      { ...options, budgetBytes: 150 * MB }
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.clearNativeImages).toBe(false);
  });
});

describe('planStorageCleanup never-delete list', () => {
  test('engine caches, PDF downloads and update bundles survive even a zero budget', () => {
    const kept = [
      'http-cache',
      'nitro_cronet_cache',
      'nitrofetch_cronet_cache',
      'WebView',
      'BetterPdf/session',
      'BetterPdf/partial',
      'bundle-store',
      'bundle-manifest-temp',
      'muqun-purge-at-launch',
      'image-originals',
      'BetterPdf/renders',
    ];
    const plan = planStorageCleanup(
      kept.map((name) => entry(name, MB, 1)),
      { ...options, budgetBytes: 0 }
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.clearNativeImages).toBe(false);
    expect(plan.purgeAtNextLaunch).toEqual([]);
    expect(plan.buckets.other).toBe(kept.length * MB);
  });
});

describe('planStorageCleanup path fence', () => {
  const outside = [
    // The right name somewhere else entirely.
    { ...entry('ImagePicker'), uri: 'file:///data/app/files/ImagePicker' },
    // A sibling whose path merely starts with the root's text.
    { ...entry('ImagePicker'), uri: 'file:///data/app/cache-old/ImagePicker' },
    // Traversal in the URI or the name.
    { ...entry('ImagePicker'), uri: `${root}../files/ImagePicker` },
    entry('../files/theme-stage-x'),
    entry('theme-stage-x/../../files'),
    // A name that does not match its URI.
    { ...entry('theme-stage-a'), uri: `${root}theme-stage-b/../../files` },
    { ...entry('ImagePicker'), uri: `${root}DocumentPicker` },
    // Nested paths are only allowed inside the folders the walk opens.
    entry('ImagePicker/inner'),
    entry('image-originals/a/b'),
    // The root itself.
    { ...entry('ImagePicker'), uri: root },
    { ...entry('image-originals/a'), uri: 'file:///data/app/files/image-originals/a' },
  ];

  test('never plans a path outside the cache directory', () => {
    const plan = planStorageCleanup(outside, { ...options, budgetBytes: 0 });
    expect(plan.deletions).toEqual([]);
    expect(plan.reclaimableBytes).toBe(0);
    for (const item of planStorageCleanup(
      [...outside, entry('ImagePicker'), entry('image-originals/ok')],
      { ...options, budgetBytes: 0 }
    ).deletions) {
      expect(item.uri.startsWith(root)).toBe(true);
      expect(item.uri.includes('/../')).toBe(false);
    }
  });

  test('a native image cache reported outside the root is not cleared', () => {
    const plan = planStorageCleanup(
      [
        {
          ...entry('image_manager_disk_cache'),
          uri: 'file:///data/app/files/image_manager_disk_cache',
        },
      ],
      { ...options, budgetBytes: 0 }
    );
    expect(plan.clearNativeImages).toBe(false);
  });
});

describe('planLruTrim', () => {
  test('drops the oldest files until the rest fit the cap', () => {
    const files = [
      { name: 'b', bytes: 20, modifiedAtMs: 2 },
      { name: 'a', bytes: 20, modifiedAtMs: 1 },
      { name: 'c', bytes: 20, modifiedAtMs: 3 },
    ];
    expect(planLruTrim(files, 40)).toEqual(['a']);
    expect(planLruTrim(files, 60)).toEqual([]);
    expect(planLruTrim(files, 0)).toEqual(['a', 'b', 'c']);
  });

  test('unknown sizes free nothing', () => {
    expect(
      planLruTrim(
        [
          { name: 'broken', bytes: Number.NaN, modifiedAtMs: 0 },
          { name: 'real', bytes: 50, modifiedAtMs: 1 },
        ],
        10
      )
    ).toEqual(['broken', 'real']);
  });
});
