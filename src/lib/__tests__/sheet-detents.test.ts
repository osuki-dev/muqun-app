import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

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

test('the platform is read once, from the bundler, not from a Platform import', () => {
  const source = readFileSync('src/lib/route-presentation.ts', 'utf8');
  // `process.env.EXPO_OS` is inlined per platform bundle, so the branch costs
  // nothing at runtime and the other platform's value is not even shipped. The
  // same mechanism `sheet-route-frame.tsx` uses for the Android grabber.
  expect(source).toContain('platform: string | undefined = process.env.EXPO_OS');
  expect(source).not.toContain("from 'react-native'");
});

/**
 * The reasoning is load-bearing, so it has to stay in the file.
 *
 * This fix looks like a downgrade -- Android loses the drag -- and the only
 * thing that stops someone restoring the second detent in good faith is the
 * record of what was checked. Each of these is a documented escape that does
 * not work, cited where it lives.
 */
test('the file still says which documented escapes were ruled out, and where', () => {
  const source = readFileSync('src/lib/route-presentation.ts', 'utf8');
  for (const citation of [
    'FormSheetDimensionsCoordinator.kt:75-81', // the largest-detent layout is by design
    'findScrollingChild', // nesting is not the problem
    'sheetExpandsWhenScrolledToEdge', // iOS only; read nowhere on Android
    'sheetInitialDetentIndex', // moves the sheet, not the layout
    'unstable_sheetFooter', // an overlay; cannot size a viewport
    'BottomSheetBehaviorExt.kt:19-34', // useSingleDetent, which is the fix
  ]) {
    expect({ citation, kept: source.includes(citation) }).toEqual({ citation, kept: true });
  }
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

test('the sheets the owner reported are the ones that open tall', () => {
  // Named rather than merely counted: these are the lists whose last row was
  // unreachable, and a change that quietly reclassifies one fails here.
  for (const route of [
    'agent-model',
    'agent-workspace',
    'agent-sessions',
    'agent-worktree',
    'panels',
    'sessions',
    'artifacts',
    'git-diff',
    'agent-vcs-diff',
    'settings-theme-browse',
    // The owner's second round: long content opens tall, whether or not it is
    // a list. Pairing and the context sheet were both found cut off at the
    // first detent, and the rest are the same shape.
    'explore',
    'agent-context',
    'agent-mode',
    'settings-language',
    'settings-font',
    'opencode-guide',
  ]) {
    expect({ route, content: sheetRouteContent[route] }).toEqual({ route, content: 'list' });
  }

  // And a short form stays short, which is the other half of the judgement.
  for (const route of ['new-task', 'web-service']) {
    expect({ route, content: sheetRouteContent[route] }).toEqual({ route, content: 'short' });
  }
});

test('the layout asks the table for a sheet route rather than spelling a height', () => {
  const layout = readFileSync('src/app/_layout.tsx', 'utf8');

  // No detent literal survives in the layout: that duplication is what let the
  // table claim to be the only place a height is chosen while it was not.
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
