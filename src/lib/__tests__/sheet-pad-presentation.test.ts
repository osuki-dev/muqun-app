import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  isFullscreenSheetRoute,
  sheetPresentationFor,
  sheetRouteKinds,
  sheetRouteOptions,
  sheetRoutePresentations,
} from '../route-presentation';

/**
 * Work surfaces are full-screen on a Pad; pickers stay a card; phones never
 * change. The owner's report was the Changes sheet: a diff in a centred
 * form-sheet card in the middle of a 13-inch iPad.
 */
const WORK_SURFACES = [
  'agent-session-tree',
  'agent-subagent-detail',
  'agent-tool-detail',
  'agent-vcs-diff',
  'artifacts',
  'explore',
  'git-diff',
  'settings-theme-browse',
];

test('the rule: only a work surface on a Pad is full-screen', () => {
  expect(sheetPresentationFor('workSurface', { isPad: true })).toBe('fullscreen');
  expect(sheetPresentationFor('workSurface', { isPad: false })).toBe('sheet');
  expect(sheetPresentationFor('picker', { isPad: true })).toBe('sheet');
  expect(sheetPresentationFor('picker', { isPad: false })).toBe('sheet');
});

test('every sheet route declares its kind, and the work surfaces are the listed ones', () => {
  const sheets = Object.entries(sheetRoutePresentations)
    .filter(([, presentation]) => presentation === 'sheet')
    .map(([route]) => route)
    .sort();
  expect(Object.keys(sheetRouteKinds).sort()).toEqual(sheets);
  const surfaces = Object.entries(sheetRouteKinds)
    .filter(([, kind]) => kind === 'workSurface')
    .map(([route]) => route)
    .sort();
  expect(surfaces).toEqual(WORK_SURFACES);
});

test('a phone keeps every sheet exactly as it was', () => {
  for (const route of Object.keys(sheetRoutePresentations)) {
    expect({ route, options: sheetRouteOptions(route, undefined, false, false) }).toEqual({
      route,
      options: sheetRouteOptions(route),
    });
    expect(isFullscreenSheetRoute(route, false)).toBe(false);
  }
});

test('on a Pad a work surface is a fullScreenModal with no grabber and no detents', () => {
  for (const route of WORK_SURFACES) {
    const options = sheetRouteOptions(route, undefined, false, true);
    expect({ route, presentation: options.presentation }).toEqual({
      route,
      presentation: 'fullScreenModal',
    });
    expect(options.sheetGrabberVisible).toBeUndefined();
    expect(options.sheetAllowedDetents).toBeUndefined();
    // Not swipeable on iOS: the scene's close button is the way out.
    expect(options.gestureEnabled).toBe(false);
    expect(isFullscreenSheetRoute(route, true)).toBe(true);
    expect(sheetRouteOptions(route, undefined, true, true).animation).toBe('none');
  }
});

test('on a Pad non-settings pickers keep their existing form-sheet options', () => {
  for (const [route, kind] of Object.entries(sheetRouteKinds)) {
    if (kind !== 'picker' || route.startsWith('settings-')) continue;
    expect({ route, options: sheetRouteOptions(route, undefined, false, true) }).toEqual({
      route,
      options: sheetRouteOptions(route),
    });
    expect(sheetRouteOptions(route, undefined, false, true).presentation).toBe('formSheet');
  }
});

test('Android Pad settings constrain the whole sheet content without changing native detents', () => {
  const routes = Object.keys(sheetRouteKinds).filter(
    (route) => route.startsWith('settings-') && sheetRouteKinds[route] === 'picker'
  );
  for (const route of routes) {
    const phone = sheetRouteOptions(route, undefined, false, false, 'android');
    const pad = sheetRouteOptions(route, undefined, false, true, 'android');
    expect(pad.presentation).toBe('formSheet');
    expect(pad.sheetAllowedDetents).toEqual(phone.sheetAllowedDetents);
    expect(pad.sheetGrabberVisible).toBe(true);
    expect(pad.contentStyle).toMatchObject({
      width: '100%',
      maxWidth: 640,
      alignSelf: 'center',
      // Screens gives fitToContents an absolute wrapper with start/end: 0.
      // Explicit auto insets let Yoga use alignSelf instead of pinning left.
      start: 'auto',
      end: 'auto',
      backgroundColor: 'transparent',
      overflow: 'hidden',
    });
    expect(pad.sheetElevation).toBe(0);
    expect(phone.contentStyle).toEqual({ backgroundColor: 'transparent' });
    expect(sheetRouteOptions(route, undefined, false, true, 'ios')).toEqual(phone);
    expect(sheetRouteOptions(route, undefined, true, true, 'android').animation).toBe('none');
  }
});

test('the Android width cap does not narrow full-screen catalogues or other pickers', () => {
  expect(
    sheetRouteOptions('settings-theme-browse', undefined, false, true, 'android').presentation
  ).toBe('fullScreenModal');
  expect(
    sheetRouteOptions('settings-theme-browse', undefined, false, true, 'android').contentStyle
  ).toBeUndefined();
  expect(sheetRouteOptions('agent-model', undefined, false, true, 'android').contentStyle).toEqual({
    backgroundColor: 'transparent',
  });
});

test('the two full-screen routes are full-screen everywhere and draw no sheet close', () => {
  for (const route of ['custom-theme', 'simfarm']) {
    expect(sheetRoutePresentations[route]).toBe('fullscreen');
    expect(sheetRouteOptions(route, undefined, false, true)).toEqual(sheetRouteOptions(route));
    // They have their own way out; the scene's button is for promoted sheets.
    expect(isFullscreenSheetRoute(route, true)).toBe(false);
  }
});

/**
 * A full-screen modal has no grabber and, on iOS, no swipe. The close button
 * lives in `SheetScene`, so every work surface must be built on it -- a work
 * surface drawn some other way would be a Pad screen with no way out.
 */
const WORK_SURFACE_FRAMES: Record<string, string> = {
  'git-diff': 'src/components/changes-sheet.tsx',
  'agent-vcs-diff': 'src/components/changes-sheet.tsx',
  artifacts: 'src/components/session-artifacts.tsx',
  'agent-session-tree': 'src/components/agent-session-tree-sheet.tsx',
  'agent-subagent-detail': 'src/components/agent-subagent-detail-sheet.tsx',
  'agent-tool-detail': 'src/components/tool-call-detail-sheet.tsx',
  'settings-theme-browse': 'src/components/theme-browse-sheet.tsx',
  explore: 'src/app/explore.tsx',
};

test('every work surface is built on the scene that draws its close button', () => {
  expect(Object.keys(WORK_SURFACE_FRAMES).sort()).toEqual(WORK_SURFACES);
  for (const [route, file] of Object.entries(WORK_SURFACE_FRAMES)) {
    expect({ route, scene: /<SheetScene[\s>]/.test(readFileSync(file, 'utf8')) }).toEqual({
      route,
      scene: true,
    });
  }
  const scene = readFileSync('src/components/sheet-scene.tsx', 'utf8');
  expect(scene).toContain('const fullscreen = useSheetIsFullscreen();');
  expect(scene).toContain('<SheetSceneClose />');
  expect(scene).toContain('testID="sheet-close"');
  // And the root stack is what tells it.
  const layout = readFileSync('src/app/_layout.tsx', 'utf8');
  expect(layout).toContain(
    '<SheetFullscreenProvider value={isFullscreenSheetRoute(route.name, isPad)}>'
  );
  expect(layout).toContain("responsiveWorkspaceLayout(windowWidth).mode === 'pad'");
});
