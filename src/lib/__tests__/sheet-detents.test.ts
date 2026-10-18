import { expect, test } from 'bun:test';

import {
  resolveDetents,
  sheetPresentationOptions,
  sheetRouteContent,
  sheetRouteDetents,
  sheetRoutePresentations,
} from '../route-presentation';

/**
 * One detent on Android, and which one.
 *
 * react-native-screens lays an Android form sheet out at its *largest* detent
 * and reaches a smaller one by sliding the whole view down the screen, while
 * handing Yoga the largest detent's height either way. The scroller inside is
 * therefore given a viewport taller than the sheet the reader can see, and the
 * excess hangs below the screen edge where no amount of scrolling reaches it.
 *
 * That is the library's design and not a bug to be arranged around -- the
 * citation, and every documented escape that was checked and ruled out, is on
 * `resolveDetents`. A single detent is the only thing that makes the laid-out
 * height and the visible height the same number.
 *
 * What changed here is *which* single detent. A list sheet now takes its
 * largest, so the model picker arrives tall instead of at 60% of the screen;
 * short sheets keep the height they always opened at. These tests are what
 * stops a second detent coming back on Android, and what stops a list sheet
 * quietly going back to opening small.
 */

test('an Android list sheet gets one detent, and it is the largest', () => {
  // The model picker: `[0.6, 1]` collapses to the top of its range, so all 126
  // rows are in one tall, fully scrollable sheet.
  expect(resolveDetents([0.6, 1], 'list', 'android')).toEqual([1]);
  // `expandable` -- the workspace, sessions and worktree pickers.
  expect(resolveDetents('expandable', 'list', 'android')).toEqual([1]);
  // The tasks and shells sheets, whose largest detent is not 1.
  expect(resolveDetents([0.65, 0.9], 'list', 'android')).toEqual([0.9]);
});

test('an Android short sheet keeps the height it opens at', () => {
  // The first, not the largest: a sheet asking for four options should not
  // arrive at full height, and with one detent it is reachable either way.
  expect(resolveDetents('expandable', 'short', 'android')).toEqual([0.82]);
  expect(resolveDetents([0.6, 1], 'short', 'android')).toEqual([0.6]);
  expect(resolveDetents([0.65, 0.9], 'short', 'android')).toEqual([0.65]);

  // `short` is the default, so a caller that forgets cannot accidentally make a
  // sheet taller than its author chose.
  expect(resolveDetents('expandable', undefined, 'android')).toEqual([0.82]);
});

test('a sheet that already asked for one height is left alone', () => {
  for (const content of ['list', 'short'] as const) {
    expect(resolveDetents('full', content, 'android')).toEqual([1]);
    expect(resolveDetents([0.9], content, 'android')).toEqual([0.9]);
    // Fit-to-contents is not a detent array at all: the sheet is as tall as
    // what it holds, so there is no second height to fall through.
    expect(resolveDetents('fitToContents', content, 'android')).toBe('fitToContents');
  }
});

test('iOS keeps every detent, because it resizes the sheet to each one', () => {
  for (const content of ['list', 'short'] as const) {
    expect(resolveDetents('expandable', content, 'ios')).toEqual([0.82, 1]);
    expect(resolveDetents([0.6, 1], content, 'ios')).toEqual([0.6, 1]);
    expect(resolveDetents([0.65, 0.9], content, 'ios')).toEqual([0.65, 0.9]);
    expect(resolveDetents('full', content, 'ios')).toEqual([1]);
    expect(resolveDetents('fitToContents', content, 'ios')).toBe('fitToContents');
  }
});

test('the largest detent is the highest value, not the last one written', () => {
  // The native side reads the array with `SheetDetents.highest()`, so a table
  // entry written out of order must not hand Android a *smaller* single detent
  // than the sheet was laid out at -- that is the dead zone all over again.
  expect(resolveDetents([1, 0.6], 'list', 'android')).toEqual([1]);
});

test('presentation options carry the resolved detents, not the raw ones', () => {
  const options = sheetPresentationOptions('sheet', 'expandable');
  expect(options.presentation).toBe('formSheet');
  expect(options.sheetAllowedDetents).toEqual(resolveDetents('expandable'));
  expect(sheetPresentationOptions('fullscreen').sheetAllowedDetents).toBeUndefined();

  // And the content kind reaches `resolveDetents` rather than being dropped on
  // the way through.
  expect(sheetPresentationOptions('sheet', [0.6, 1], 'list').sheetAllowedDetents).toEqual(
    resolveDetents([0.6, 1], 'list')
  );
});

/**
 * One table, read by the navigator and by nothing else that disagrees.
 *
 * Height used to be a literal second argument at each `<Stack.Screen>` while
 * presentation lived here, which made this file's claim to be the only place a
 * detent is chosen half true. Both halves are here now.
 */
test('every sheet route declares its height and its content, and only here', () => {
  const sheetRoutes = Object.entries(sheetRoutePresentations)
    .filter(([, presentation]) => presentation === 'sheet')
    .map(([route]) => route);
  expect(sheetRoutes.length).toBeGreaterThan(15);

  for (const route of sheetRoutes) {
    expect({ route, declared: route in sheetRouteDetents }).toEqual({ route, declared: true });
    expect({ route, classified: route in sheetRouteContent }).toEqual({ route, classified: true });
  }

  // Nothing in either table is a route that does not exist, which is how a
  // rename would quietly fall back to a default nobody chose.
  for (const route of [...Object.keys(sheetRouteDetents), ...Object.keys(sheetRouteContent)]) {
    expect({ route, known: route in sheetRoutePresentations }).toEqual({ route, known: true });
  }

  // The two full-screen routes are not sheets and have no detents to declare.
  expect(sheetRouteDetents['custom-theme']).toBeUndefined();
  expect(sheetRouteDetents['simfarm']).toBeUndefined();
});
