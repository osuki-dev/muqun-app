import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  resolveDetents,
  sheetDetentOvershoot,
  sheetPresentationOptions,
  sheetRouteDetents,
  sheetRoutePresentations,
} from '../route-presentation';

/**
 * Both detents on both platforms, and the arithmetic that makes that safe.
 *
 * react-native-screens lays an Android form sheet out at its *largest* detent
 * and reaches a smaller one by sliding the whole view down the screen, while
 * handing Yoga the largest detent's height either way. The scroller inside is
 * therefore given a viewport taller than the sheet the reader can see, and the
 * excess hangs below the screen edge where no amount of scrolling reaches it.
 *
 * The first answer to that was to drop the second detent on Android, which
 * fixed the dead zone by removing the drag -- and the owner asked for the drag
 * back. So the array is whole again, and `sheetDetentOvershoot` pays for it:
 * it says what fraction of the laid-out sheet is off-screen at the resting
 * detent, `SheetScene` multiplies that by the scene's own measured height, and
 * the column's bottom padding pulls the scroller's viewport onto the sheet's
 * visible edge. The full citation is on `resolveDetents`.
 *
 * These tests are what stops either half coming back on its own: a detent array
 * that is silently truncated, or an overshoot that forgets a platform.
 */

test('every detent the route asked for survives, on both platforms', () => {
  // This is the line that changed. `resolveDetents` used to answer `[0.82]` on
  // Android and the whole array everywhere else; there is no platform branch
  // here any more, because the compensation happens in the scene instead.
  expect(resolveDetents('expandable')).toEqual([0.82, 1]);
  expect(resolveDetents([0.6, 1])).toEqual([0.6, 1]);
  expect(resolveDetents([0.65, 0.9])).toEqual([0.65, 0.9]);

  // A sheet that asked for one detent still gets one.
  expect(resolveDetents('full')).toEqual([1]);
  expect(resolveDetents([0.9])).toEqual([0.9]);

  // And fit-to-contents is not a detent array at all: the sheet is as tall as
  // what it holds, so there is no second height to fall through.
  expect(resolveDetents('fitToContents')).toBe('fitToContents');

  // A copy, never the caller's array: these come from a frozen module table
  // that the navigator must not be able to write through.
  const source: readonly number[] = [0.6, 1];
  const resolved: unknown = resolveDetents(source);
  expect(resolved).toEqual([0.6, 1]);
  expect(resolved).not.toBe(source);
});

test('the overshoot is the fraction of the sheet hanging below the screen', () => {
  // `[0.6, 1]` -- the model picker. Laid out at 1, resting at 0.6, so two fifths
  // of the layout is under the screen edge and the last rows of 126 models sit
  // in it. That is the 40% the owner could not scroll to.
  expect(sheetDetentOvershoot([0.6, 1], 0, 'android')).toBe(0.4);
  // Dragged to the top, the laid-out height and the visible height are the same
  // number and there is nothing to pay back.
  expect(sheetDetentOvershoot([0.6, 1], 1, 'android')).toBe(0);

  // `expandable` -- eighteen sheets. 1 - 0.82/1.
  expect(sheetDetentOvershoot('expandable', 0, 'android')).toBeCloseTo(0.18, 10);
  expect(sheetDetentOvershoot('expandable', 1, 'android')).toBe(0);

  // The tasks and shells sheets, whose largest detent is not 1: the fraction is
  // of the *laid-out* height, which is 0.9 of the screen and not the screen.
  // 1 - 0.65/0.9, not 0.9 - 0.65.
  expect(sheetDetentOvershoot([0.65, 0.9], 0, 'android')).toBeCloseTo(0.25 / 0.9, 10);
  expect(sheetDetentOvershoot([0.65, 0.9], 1, 'android')).toBe(0);

  // Nothing to compensate when there is only one height to be at.
  expect(sheetDetentOvershoot('full', 0, 'android')).toBe(0);
  expect(sheetDetentOvershoot([0.9], 0, 'android')).toBe(0);

  // Nor when the sheet is sized to its contents: it has no detent array, so an
  // index into one is meaningless and the sheet is exactly as tall as it looks.
  expect(sheetDetentOvershoot('fitToContents', 0, 'android')).toBe(0);
  expect(sheetDetentOvershoot('fitToContents', 1, 'android')).toBe(0);
});

test('iOS pays nothing, because it resizes the presented view to each detent', () => {
  for (const index of [0, 1]) {
    expect(sheetDetentOvershoot('expandable', index, 'ios')).toBe(0);
    expect(sheetDetentOvershoot([0.6, 1], index, 'ios')).toBe(0);
    expect(sheetDetentOvershoot([0.65, 0.9], index, 'ios')).toBe(0);
  }
  // Every other platform too, web included: the bug is Android's layout, and
  // anything that is not it keeps exactly the geometry it has today.
  expect(sheetDetentOvershoot([0.6, 1], 0, 'web')).toBe(0);
  expect(sheetDetentOvershoot([0.6, 1], 0, undefined)).toBe(0);
});

test('a detent index from outside the array cannot become negative padding', () => {
  // The index arrives from native, so it is trusted but not proven. Clamped to
  // the array at both ends, and the result clamped to [0, 1]: a table written
  // out of order is a bug to fix, not a reason to take height off a sheet.
  expect(sheetDetentOvershoot([0.6, 1], -1, 'android')).toBe(0.4);
  expect(sheetDetentOvershoot([0.6, 1], 7, 'android')).toBe(0);
  expect(sheetDetentOvershoot([0.6, 1], 1.9, 'android')).toBe(0);
  expect(sheetDetentOvershoot([], 0, 'android')).toBe(0);

  // Descending is read the same way the native side reads it -- by the highest
  // value, not by the last one (`sheetDetents.highest()`).
  expect(sheetDetentOvershoot([1, 0.6], 1, 'android')).toBe(0.4);
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
  const options = sheetPresentationOptions('sheet', 'expandable');
  expect(options.presentation).toBe('formSheet');
  expect(options.sheetAllowedDetents).toEqual(resolveDetents('expandable'));
  expect(sheetPresentationOptions('fullscreen').sheetAllowedDetents).toBeUndefined();
});

/**
 * The scene reads the same table the navigator does.
 *
 * A screen cannot read its own navigation options, so `SheetScene` looks its
 * detents up by route name -- which only works while the route table and
 * `_layout.tsx` are the same table. They used to be two: presentation here,
 * height as a literal second argument at each `<Stack.Screen>`.
 */
test('every sheet route declares its height in the table, and only there', () => {
  const sheetRoutes = Object.entries(sheetRoutePresentations)
    .filter(([, presentation]) => presentation === 'sheet')
    .map(([route]) => route);
  expect(sheetRoutes.length).toBeGreaterThan(15);

  for (const route of sheetRoutes) {
    expect({ route, declared: route in sheetRouteDetents }).toEqual({ route, declared: true });
  }

  // And nothing in the table is a route that does not exist, which is how a
  // renamed route would quietly fall back to `'full'` in the scene.
  for (const route of Object.keys(sheetRouteDetents)) {
    expect({ route, known: route in sheetRoutePresentations }).toEqual({ route, known: true });
  }

  // The two full-screen routes are not sheets and have no detents to declare.
  expect(sheetRouteDetents['custom-theme']).toBeUndefined();
  expect(sheetRouteDetents['simfarm']).toBeUndefined();
});

test('the layout asks the table for a sheet route rather than spelling a height', () => {
  const layout = readFileSync('src/app/_layout.tsx', 'utf8');

  // No detent literal survives in the layout: this is the duplication that let
  // the table claim to be the only place a height is chosen while it was not.
  expect(layout).not.toContain("'expandable'");
  expect(layout).not.toContain("'fitToContents'");
  expect(/sheetPresentationOptions\([^)]*\[[\d.,\s]+\]/.test(layout)).toBe(false);

  for (const route of Object.keys(sheetRouteDetents)) {
    expect({ route, wired: layout.includes(`sheetRouteOptions('${route}')`) }).toEqual({
      route,
      wired: true,
    });
  }

  // The two full-screen routes keep the explicit call, because each also
  // overrides its animation duration -- and `sheet-scene-contract.test.ts`
  // greps for exactly that spelling.
  for (const route of ['custom-theme', 'simfarm']) {
    expect({ route, explicit: layout.includes(`sheetRoutePresentations['${route}']`) }).toEqual({
      route,
      explicit: true,
    });
  }
});
