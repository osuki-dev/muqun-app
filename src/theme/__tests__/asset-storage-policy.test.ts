import { describe, expect, test } from 'bun:test';
import { planThemeAssetInstall } from '../asset-storage-policy';

describe('persistent theme asset install planning', () => {
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
    const item = { name: '__proto__', bytes: 100 * 1024 * 1024 };
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

  test('reimporting unchanged content works with 257 installed files', () => {
    const inventory = Array.from({ length: 257 }, (_, index) => ({
      name: `owned-${index}.png`,
      bytes: 1024 * 1024,
    }));
    expect(planThemeAssetInstall(inventory, [inventory[0], inventory[256]])).toEqual([]);
  });

  test('replacement retains old content until metadata commits without counting it as an archive', () => {
    const inventory = Array.from({ length: 257 }, (_, index) => ({
      name: `owned-${index}.png`,
      bytes: 1024 * 1024,
    }));
    const previous = inventory.map((entry) => ({ ...entry }));
    const incoming = [inventory[0], { name: 'replacement.webp', bytes: 1024 * 1024 }];
    expect(planThemeAssetInstall(inventory, incoming)).toEqual(['replacement.webp']);
    // Planning is additive: failed copy/persistence can keep the previous theme.
    expect(inventory).toEqual(previous);
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
    ).toThrow('safe integer');
  });

  test('deduplication preserves safe total accounting', () => {
    const full = { name: 'full', bytes: Number.MAX_SAFE_INTEGER };
    expect(planThemeAssetInstall([full], [full, full])).toEqual([]);
    expect(() =>
      planThemeAssetInstall([full], [full, full, { name: 'extra', bytes: 1 }, full])
    ).toThrow('safe integer');
  });
});
