import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { resolveDetents, sheetPresentationOptions } from '../route-presentation';

/**
 * One detent on Android, and why that is a correctness rule rather than taste.
 *
 * react-native-screens lays an Android form sheet out at its *largest* detent
 * and reaches a smaller one by sliding the whole view down the screen, while
 * handing Yoga the largest detent's height either way. The scroller inside is
 * therefore given a viewport taller than the sheet the reader can see, and the
 * excess hangs below the screen edge where no amount of scrolling reaches it --
 * `(last - current) x screen height`, which is 18% for `expandable` and 40%
 * for the model picker's `[0.6, 1]`. The full citation is on `resolveDetents`.
 *
 * So the second detent is dropped there, and these tests are what stops it
 * coming back the next time a sheet wants to open small and drag tall.
 */

test('an Android sheet gets one detent, and it is the one it opens at', () => {
  // The first, not the largest: every route picked its opening height on
  // purpose, and this must not change how any sheet looks when it appears.
  expect(resolveDetents('expandable', 'android')).toEqual([0.82]);
  expect(resolveDetents([0.6, 1], 'android')).toEqual([0.6]);
  expect(resolveDetents([0.65, 0.9], 'android')).toEqual([0.65]);

  // A sheet that already asked for one detent is already correct.
  expect(resolveDetents('full', 'android')).toEqual([1]);
  expect(resolveDetents([0.9], 'android')).toEqual([0.9]);

  // And fit-to-contents is not a detent array at all: the sheet is as tall as
  // what it holds, so there is no second height to fall through.
  expect(resolveDetents('fitToContents', 'android')).toBe('fitToContents');
});

test('iOS keeps every detent, because it resizes the sheet to each one', () => {
  expect(resolveDetents('expandable', 'ios')).toEqual([0.82, 1]);
  expect(resolveDetents([0.6, 1], 'ios')).toEqual([0.6, 1]);
  expect(resolveDetents([0.65, 0.9], 'ios')).toEqual([0.65, 0.9]);
  expect(resolveDetents('full', 'ios')).toEqual([1]);
  expect(resolveDetents('fitToContents', 'ios')).toBe('fitToContents');
});

test('the platform is read once, from the bundler, not from a Platform import', () => {
  const source = readFileSync('src/lib/route-presentation.ts', 'utf8');
  // `process.env.EXPO_OS` is inlined per platform bundle, so the branch costs
  // nothing at runtime and the other platform's value is not even shipped. The
  // same mechanism `sheet-route-frame.tsx` uses for the Android grabber.
  expect(source).toContain('platform: string | undefined = process.env.EXPO_OS');
  expect(source).not.toContain("from 'react-native'");
});

test('presentation options carry the resolved detents, not the raw ones', () => {
  // The default: `sheetPresentationOptions` reads the ambient platform, which
  // under the test runner is neither, so it is the untouched array. The point
  // of the assertion is that it goes through `resolveDetents` at all.
  const options = sheetPresentationOptions('sheet', 'expandable');
  expect(options.presentation).toBe('formSheet');
  expect(options.sheetAllowedDetents).toEqual(resolveDetents('expandable'));
  expect(sheetPresentationOptions('fullscreen').sheetAllowedDetents).toBeUndefined();
});
