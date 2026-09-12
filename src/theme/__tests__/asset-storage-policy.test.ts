import { describe, expect, test } from 'bun:test';
import { planThemeAssetInstall, THEME_ASSET_STORAGE_LIMITS } from '../asset-storage-policy';

describe('persistent theme asset storage quota', () => {
  test('reuses existing files and returns only unique additions in arrival order', () => {
    const existing = [{ name: 'shared.png', bytes: 30 }];
    const incoming = [
      { name: 'shared.png', bytes: 30 },
      { name: 'new.webp', bytes: 40 },
      { name: 'new.webp', bytes: 40 },
      { name: 'last.jpeg', bytes: 0 },
    ];
    expect(planThemeAssetInstall(existing, incoming)).toEqual(['new.webp', 'last.jpeg']);
    expect(existing).toEqual([{ name: 'shared.png', bytes: 30 }]);
    expect(incoming).toHaveLength(4);
  });

  test('deduplicates inventory without confusing prototype-like opaque names', () => {
    const item = { name: '__proto__', bytes: THEME_ASSET_STORAGE_LIMITS.bytes };
    expect(planThemeAssetInstall([item, item], [item, item])).toEqual([]);
    expect(planThemeAssetInstall([], [{ name: 'constructor', bytes: 1 }])).toEqual(['constructor']);
  });

  test('rejects conflicting sizes within inventory, incoming, and across both', () => {
    const a = { name: 'same', bytes: 1 };
    const b = { name: 'same', bytes: 2 };
    expect(() => planThemeAssetInstall([a, b], [])).toThrow('Conflicting');
    expect(() => planThemeAssetInstall([], [a, b])).toThrow('Conflicting');
    expect(() => planThemeAssetInstall([a], [b])).toThrow('Conflicting');
  });

  test('accepts exactly the byte boundary and rejects one extra byte', () => {
    const inventory = [
      { name: 'unknown-unmanaged-file', bytes: THEME_ASSET_STORAGE_LIMITS.bytes - 1 },
    ];
    expect(planThemeAssetInstall(inventory, [{ name: 'new', bytes: 1 }])).toEqual(['new']);
    expect(() => planThemeAssetInstall(inventory, [{ name: 'new', bytes: 2 }])).toThrow('100 MiB');
    expect(() =>
      planThemeAssetInstall([{ name: 'old', bytes: THEME_ASSET_STORAGE_LIMITS.bytes + 1 }], [])
    ).toThrow('100 MiB');
  });

  test('counts zero-byte files toward the exact file-count boundary', () => {
    const inventory = Array.from({ length: 255 }, (_, index) => ({
      name: `unknown-${index}`,
      bytes: 0,
    }));
    expect(planThemeAssetInstall(inventory, [{ name: 'last', bytes: 0 }])).toEqual(['last']);
    expect(() =>
      planThemeAssetInstall(inventory, [
        { name: 'last', bytes: 0 },
        { name: 'excess', bytes: 0 },
      ])
    ).toThrow('256 files');
    expect(() =>
      planThemeAssetInstall(
        [...inventory, { name: 'last', bytes: 0 }, { name: 'excess', bytes: 0 }],
        []
      )
    ).toThrow('256 files');
  });

  test('rejects invalid sizes in either input, including duplicate entries', () => {
    for (const bytes of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => planThemeAssetInstall([{ name: 'bad', bytes }], [])).toThrow('safe integer');
      expect(() => planThemeAssetInstall([], [{ name: 'bad', bytes }])).toThrow('safe integer');
      expect(() =>
        planThemeAssetInstall([{ name: 'bad', bytes: 1 }], [{ name: 'bad', bytes }])
      ).toThrow('safe integer');
    }
    expect(() =>
      planThemeAssetInstall(
        [{ name: 'first', bytes: 1 }],
        [{ name: 'huge', bytes: Number.MAX_SAFE_INTEGER }]
      )
    ).toThrow('100 MiB');
  });

  test('duplicates cannot hide new bytes or files past quota', () => {
    const full = { name: 'full', bytes: THEME_ASSET_STORAGE_LIMITS.bytes };
    expect(() =>
      planThemeAssetInstall([full], [full, full, { name: 'extra', bytes: 1 }, full])
    ).toThrow('100 MiB');
    const files = Array.from({ length: 256 }, (_, index) => ({ name: String(index), bytes: 0 }));
    expect(planThemeAssetInstall(files, [...files, ...files])).toEqual([]);
    expect(() => planThemeAssetInstall(files, [...files, { name: 'extra', bytes: 0 }])).toThrow(
      '256 files'
    );
  });
});
