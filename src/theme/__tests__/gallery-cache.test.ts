import { beforeEach, expect, test } from 'bun:test';

import {
  cachedThemeIndex,
  clearThemeIndex,
  putThemeIndex,
  THEME_INDEX_MAX_AGE_MS,
} from '../gallery-cache';
import type { ThemeIndexEntry } from '../gallery';

const entries: ThemeIndexEntry[] = [
  { id: 'x', name: 'X', version: '1.0.0', package: 'dist/x.muqun-theme', bytes: 10 },
];

// Module state, so every test starts from nothing rather than from whatever the
// one before it left.
beforeEach(clearThemeIndex);

test('nothing is cached until something is put there', () => {
  expect(cachedThemeIndex()).toBeNull();
});

test('the catalogue is held inside the max age and dropped outside it', () => {
  putThemeIndex(entries, 1_000);
  expect(cachedThemeIndex(1_000)).toBe(entries);
  expect(cachedThemeIndex(1_000 + THEME_INDEX_MAX_AGE_MS - 1)).toBe(entries);
  // The bound itself is stale: an hour old is an hour old.
  expect(cachedThemeIndex(1_000 + THEME_INDEX_MAX_AGE_MS)).toBeNull();
});

test('a clock that has gone backwards cannot pin a stale catalogue', () => {
  putThemeIndex(entries, 10 * THEME_INDEX_MAX_AGE_MS);
  expect(cachedThemeIndex(0)).toBeNull();
});

test('Try again is the one thing that bypasses the age', () => {
  putThemeIndex(entries, 1_000);
  clearThemeIndex();
  expect(cachedThemeIndex(1_000)).toBeNull();
});
