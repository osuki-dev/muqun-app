import { describe, expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
import type { InstalledTheme } from '@/theme/repository';

import { planUnusedThemes, type ThemeAssetFile } from '../theme-storage';

const ASSET_ROOT = 'file:///data/user/0/dev.osuki.muqun/files/theme-assets-v1';

/** A digest-shaped name, the way `theme/assets.native.ts` writes one. */
function digest(seed: string): string {
  return seed.repeat(64).slice(0, 64) + '.png';
}

function installed(id: string, names: string[] = []): InstalledTheme {
  return {
    id,
    manifest: createThemeStarter(),
    assets: Object.fromEntries(
      names.map((name, index) => [`image-${index}`, `${ASSET_ROOT}/${name}`])
    ),
  };
}

function file(name: string, bytes: number): ThemeAssetFile {
  return { name, uri: `${ASSET_ROOT}/${name}`, bytes };
}

describe('planUnusedThemes', () => {
  test('an empty library offers nothing, whatever is on disk', () => {
    expect(planUnusedThemes([], null, [file(digest('a'), 4_000)])).toEqual({
      removable: [],
      reclaimableBytes: 0,
      count: 0,
    });
  });

  test('the applied theme is never removable', () => {
    const applied = installed('applied', [digest('a')]);
    const other = installed('other', [digest('b')]);
    const plan = planUnusedThemes([applied, other], { kind: 'custom', id: 'applied' }, [
      file(digest('a'), 4_000),
      file(digest('b'), 1_000),
    ]);
    expect(plan.removable.map((theme) => theme.id)).toEqual(['other']);
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(1_000);
  });

  test('the only installed theme, applied, leaves nothing to offer', () => {
    const plan = planUnusedThemes(
      [installed('applied', [digest('a')])],
      { kind: 'custom', id: 'applied' },
      [file(digest('a'), 4_000)]
    );
    expect(plan).toEqual({ removable: [], reclaimableBytes: 0, count: 0 });
  });

  test('a built-in selection owns no files, so every custom theme is removable', () => {
    const themes = [installed('one', [digest('a')]), installed('two', [digest('b')])];
    const plan = planUnusedThemes(themes, { kind: 'builtin', id: 'osuki' }, [
      file(digest('a'), 4_000),
      file(digest('b'), 1_000),
    ]);
    expect(plan.removable.map((theme) => theme.id)).toEqual(['one', 'two']);
    expect(plan.count).toBe(2);
    expect(plan.reclaimableBytes).toBe(5_000);
  });

  test('no selection at all is the same as a built-in one', () => {
    const plan = planUnusedThemes([installed('one', [digest('a')])], null, [
      file(digest('a'), 4_000),
    ]);
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(4_000);
  });

  test('a file the applied theme shares is not reclaimable', () => {
    // Content-addressed storage means two themes carrying the same picture are
    // one file. Removing the unapplied one frees the file it holds alone and
    // not a byte of the shared one, so the row must not promise it back.
    const shared = digest('a');
    const plan = planUnusedThemes(
      [installed('applied', [shared]), installed('other', [shared, digest('b')])],
      { kind: 'custom', id: 'applied' },
      [file(shared, 4_000), file(digest('b'), 1_000)]
    );
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(1_000);
  });

  test('a file two removable themes share is counted once', () => {
    const shared = digest('a');
    const plan = planUnusedThemes(
      [installed('one', [shared]), installed('two', [shared])],
      { kind: 'builtin', id: 'osuki' },
      [file(shared, 4_000)]
    );
    expect(plan.count).toBe(2);
    expect(plan.reclaimableBytes).toBe(4_000);
  });

  test('a file nobody references is not on offer here', () => {
    // Unreferenced bytes are the asset collector's business, and it runs on
    // every library change whether or not this row is ever pressed. Counting
    // them here would report a number removal cannot produce.
    const plan = planUnusedThemes(
      [installed('one', [digest('a')])],
      { kind: 'builtin', id: 'osuki' },
      [file(digest('a'), 1_000), file(digest('c'), 9_000), file('pending-abc.part', 7_000)]
    );
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(1_000);
  });

  test('a duplicated listing entry does not double the promise', () => {
    const plan = planUnusedThemes(
      [installed('one', [digest('a')])],
      { kind: 'builtin', id: 'osuki' },
      [file(digest('a'), 1_000), file(digest('a'), 1_000)]
    );
    expect(plan.reclaimableBytes).toBe(1_000);
  });

  test('a filesystem that will not answer contributes nothing, not a negative', () => {
    const plan = planUnusedThemes(
      [installed('one', [digest('a'), digest('b'), digest('c')])],
      { kind: 'builtin', id: 'osuki' },
      [
        file(digest('a'), Number.NaN),
        file(digest('b'), -1),
        file(digest('c'), Number.POSITIVE_INFINITY),
      ]
    );
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(0);
  });

  test('a selection naming a theme that is not installed protects nothing', () => {
    // What a half-written library hydrates into. There is no theme on screen to
    // protect, so the list is every theme there is rather than every theme but
    // an absent one.
    const plan = planUnusedThemes(
      [installed('one', [digest('a')])],
      { kind: 'custom', id: 'gone' },
      [file(digest('a'), 1_000)]
    );
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(1_000);
  });

  test('a theme with no assets is removable and frees nothing', () => {
    const plan = planUnusedThemes([installed('colors-only')], { kind: 'builtin', id: 'osuki' }, []);
    expect(plan.count).toBe(1);
    expect(plan.reclaimableBytes).toBe(0);
  });

  test('a name matches whatever directory the walk spelled it in', () => {
    // The library's URIs were written at install time and the walk's come back
    // from the filesystem. The digest is the identity; the prefix in front of it
    // is not, and a disagreement between the two must not silently under-count.
    const name = digest('a');
    const plan = planUnusedThemes([installed('one', [name])], { kind: 'builtin', id: 'osuki' }, [
      {
        name,
        uri: `file:///var/mobile/Containers/Data/Application/NEW/theme-assets-v1/${name}`,
        bytes: 2_048,
      },
    ]);
    expect(plan.reclaimableBytes).toBe(2_048);
  });
});
