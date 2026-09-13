import { describe, expect, test } from 'bun:test';

import {
  type CacheRootEntry,
  classifyCacheEntry,
  clearableCacheBytes,
  DELETABLE_CACHE_DIRECTORIES,
  formatCacheSize,
  isDeletableCacheEntry,
  isInsideCacheRoot,
  measureCache,
  planCacheDeletions,
} from '../cache-storage';

const CACHE_ROOT = 'file:///data/user/0/dev.osuki.muqun/cache';
const DOCUMENT_ROOT = 'file:///data/user/0/dev.osuki.muqun/files';

function entry(name: string, bytes: number, root = CACHE_ROOT): CacheRootEntry {
  return { name, uri: `${root}/${name}`, bytes };
}

describe('classifyCacheEntry', () => {
  test('the image libraries own the images bucket', () => {
    expect(classifyCacheEntry('image_manager_disk_cache')).toBe('images');
    expect(classifyCacheEntry('com.hackemist.SDImageCache')).toBe('images');
    expect(classifyCacheEntry('enrm_image_cache')).toBe('images');
  });

  test('the picker output directories are temporary', () => {
    expect(classifyCacheEntry('ImagePicker')).toBe('temporary');
    expect(classifyCacheEntry('ImageManipulator')).toBe('temporary');
    expect(classifyCacheEntry('DocumentPicker')).toBe('temporary');
  });

  test('a theme stage is temporary whatever its random suffix is', () => {
    expect(classifyCacheEntry('theme-stage-9f1c2a7b4e0d5c6a8b3f1e2d')).toBe('temporary');
    expect(classifyCacheEntry('theme-stage-')).toBe('temporary');
  });

  test('anything else is other, which is the point of an allow-list', () => {
    // Cronet on Android and NSURLCache on iOS: held open by the HTTP engine,
    // and the reason the Other row says the system manages it.
    expect(classifyCacheEntry('nitrofetch_cronet_cache')).toBe('other');
    expect(classifyCacheEntry('nitrofetch_urlcache')).toBe('other');
    // A name a future dependency might pick. Reported, never deleted.
    expect(classifyCacheEntry('some_new_library_cache')).toBe('other');
    expect(classifyCacheEntry('WebKit')).toBe('other');
  });

  test('a name that merely contains an allow-listed one is not that one', () => {
    expect(classifyCacheEntry('my-ImagePicker')).toBe('other');
    expect(classifyCacheEntry('ImagePicker2')).toBe('other');
  });
});

describe('measureCache', () => {
  test('sums each bucket and the whole', () => {
    const totals = measureCache([
      entry('image_manager_disk_cache', 4_000),
      entry('enrm_image_cache', 1_000),
      entry('ImagePicker', 300),
      entry('theme-stage-abc', 700),
      entry('nitrofetch_cronet_cache', 9_000),
    ]);
    expect(totals).toEqual({ images: 5_000, temporary: 1_000, other: 9_000, total: 15_000 });
  });

  test('a filesystem that will not answer contributes nothing, not a negative', () => {
    const totals = measureCache([
      entry('ImagePicker', Number.NaN),
      entry('DocumentPicker', -1),
      entry('image_manager_disk_cache', Number.POSITIVE_INFINITY),
    ]);
    expect(totals).toEqual({ images: 0, temporary: 0, other: 0, total: 0 });
  });

  test('an empty cache measures zero rather than failing', () => {
    expect(measureCache([])).toEqual({ images: 0, temporary: 0, other: 0, total: 0 });
  });

  test('the clearable total is the two buckets the button empties', () => {
    const totals = measureCache([
      entry('image_manager_disk_cache', 4_000),
      entry('ImagePicker', 300),
      entry('nitrofetch_cronet_cache', 9_000),
    ]);
    expect(clearableCacheBytes(totals)).toBe(4_300);
  });
});

describe('isInsideCacheRoot', () => {
  test('accepts a child of the root', () => {
    expect(isInsideCacheRoot(`${CACHE_ROOT}/ImagePicker`, CACHE_ROOT)).toBe(true);
    expect(isInsideCacheRoot(`${CACHE_ROOT}/ImagePicker/a.jpg`, CACHE_ROOT)).toBe(true);
  });

  test('tolerates a trailing slash on either side of the comparison', () => {
    expect(isInsideCacheRoot(`${CACHE_ROOT}/ImagePicker/`, `${CACHE_ROOT}/`)).toBe(true);
  });

  test('refuses the root itself', () => {
    expect(isInsideCacheRoot(CACHE_ROOT, CACHE_ROOT)).toBe(false);
    expect(isInsideCacheRoot(`${CACHE_ROOT}/`, CACHE_ROOT)).toBe(false);
  });

  test('refuses anything outside the root, however close by', () => {
    expect(isInsideCacheRoot(`${DOCUMENT_ROOT}/ImagePicker`, CACHE_ROOT)).toBe(false);
    // A sibling whose name starts with the root's name: `cache` vs `cache2`.
    expect(isInsideCacheRoot(`${CACHE_ROOT}2/ImagePicker`, CACHE_ROOT)).toBe(false);
  });

  test('refuses a traversal rather than resolving it', () => {
    expect(isInsideCacheRoot(`${CACHE_ROOT}/../files/mmkv`, CACHE_ROOT)).toBe(false);
    expect(isInsideCacheRoot(`${CACHE_ROOT}/..`, CACHE_ROOT)).toBe(false);
  });

  test('refuses empty input on either side', () => {
    expect(isInsideCacheRoot('', CACHE_ROOT)).toBe(false);
    expect(isInsideCacheRoot(`${CACHE_ROOT}/ImagePicker`, '')).toBe(false);
  });
});

describe('isDeletableCacheEntry', () => {
  test('the allow-list, and the image libraries deliberately not on it', () => {
    for (const name of DELETABLE_CACHE_DIRECTORIES) expect(isDeletableCacheEntry(name)).toBe(true);
    expect(isDeletableCacheEntry('theme-stage-9f1c2a7b')).toBe(true);
    // Emptied through `Image.clearDiskCache()`, never by removing the directory
    // out from under Glide or SDWebImage.
    expect(isDeletableCacheEntry('image_manager_disk_cache')).toBe(false);
    expect(isDeletableCacheEntry('com.hackemist.SDImageCache')).toBe(false);
  });

  test('nothing in the other bucket is deletable', () => {
    expect(isDeletableCacheEntry('nitrofetch_cronet_cache')).toBe(false);
    expect(isDeletableCacheEntry('nitrofetch_urlcache')).toBe(false);
    expect(isDeletableCacheEntry('WebKit')).toBe(false);
  });

  test('a name that is not a plain name is refused', () => {
    expect(isDeletableCacheEntry('')).toBe(false);
    expect(isDeletableCacheEntry('.')).toBe(false);
    expect(isDeletableCacheEntry('..')).toBe(false);
    expect(isDeletableCacheEntry('../ImagePicker')).toBe(false);
    expect(isDeletableCacheEntry('ImagePicker/../..')).toBe(false);
  });
});

describe('planCacheDeletions', () => {
  test('plans the allow-listed entries and leaves the rest alone', () => {
    const plan = planCacheDeletions(
      [
        entry('image_manager_disk_cache', 4_000),
        entry('com.hackemist.SDImageCache', 4_000),
        entry('enrm_image_cache', 1_000),
        entry('ImagePicker', 300),
        entry('ImageManipulator', 100),
        entry('DocumentPicker', 50),
        entry('theme-stage-abc123', 700),
        entry('nitrofetch_cronet_cache', 9_000),
      ],
      CACHE_ROOT
    );
    expect(plan.map((item) => item.name)).toEqual([
      'enrm_image_cache',
      'ImagePicker',
      'ImageManipulator',
      'DocumentPicker',
      'theme-stage-abc123',
    ]);
  });

  test('every planned deletion is a child of the cache root', () => {
    const plan = planCacheDeletions(
      [
        entry('enrm_image_cache', 1),
        entry('ImagePicker', 1),
        entry('ImageManipulator', 1),
        entry('DocumentPicker', 1),
        entry('theme-stage-abc123', 1),
        entry('nitrofetch_cronet_cache', 1),
      ],
      CACHE_ROOT
    );
    expect(plan).not.toHaveLength(0);
    for (const item of plan) {
      expect(isInsideCacheRoot(item.uri, CACHE_ROOT)).toBe(true);
      expect(item.uri.startsWith(`${CACHE_ROOT}/`)).toBe(true);
    }
  });

  test('a walker reporting the document directory yields no deletion at all', () => {
    // The app's real data: the MMKV stores, the installed theme assets, the
    // updates bundle. A walk that handed these over -- a wrong root, a symlink,
    // a refactor -- must produce an empty plan, not a plausible-looking one.
    const plan = planCacheDeletions(
      [
        entry('ImagePicker', 10, DOCUMENT_ROOT),
        entry('DocumentPicker', 10, DOCUMENT_ROOT),
        entry('ImageManipulator', 10, DOCUMENT_ROOT),
        entry('enrm_image_cache', 10, DOCUMENT_ROOT),
        entry('theme-stage-abc123', 10, DOCUMENT_ROOT),
        entry('theme-assets-v1', 10, DOCUMENT_ROOT),
        entry('mmkv', 10, DOCUMENT_ROOT),
        entry('.expo-internal', 10, DOCUMENT_ROOT),
        { name: 'mmkv', uri: `${DOCUMENT_ROOT}/mmkv/app-settings`, bytes: 10 },
      ],
      CACHE_ROOT
    );
    expect(plan).toEqual([]);
  });

  test('an entry whose uri escapes the root is dropped even under an allowed name', () => {
    const plan = planCacheDeletions(
      [
        { name: 'ImagePicker', uri: `${CACHE_ROOT}/../files/mmkv`, bytes: 10 },
        { name: 'DocumentPicker', uri: CACHE_ROOT, bytes: 10 },
        { name: 'ImageManipulator', uri: '', bytes: 10 },
      ],
      CACHE_ROOT
    );
    expect(plan).toEqual([]);
  });

  test('nothing outside the cache root can be planned, whatever the name', () => {
    const names = [
      ...DELETABLE_CACHE_DIRECTORIES,
      'theme-stage-abc',
      'mmkv',
      'theme-assets-v1',
      '.expo-internal',
    ];
    for (const root of [DOCUMENT_ROOT, 'file:///', 'file:///data/user/0/dev.osuki.muqun']) {
      const plan = planCacheDeletions(
        names.map((name) => entry(name, 1, root)),
        CACHE_ROOT
      );
      expect(plan).toEqual([]);
    }
  });
});

describe('formatCacheSize', () => {
  test('says zero rather than nothing, so an empty row still reads as finished', () => {
    expect(formatCacheSize(0)).toBe('0 B');
    expect(formatCacheSize(-1)).toBe('0 B');
    expect(formatCacheSize(Number.NaN)).toBe('0 B');
  });

  test('matches the wording the artifacts list already uses', () => {
    expect(formatCacheSize(512)).toBe('512 B');
    expect(formatCacheSize(1024)).toBe('1.0 KB');
    expect(formatCacheSize(1536)).toBe('1.5 KB');
    expect(formatCacheSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
