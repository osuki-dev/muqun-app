import { expect, test } from 'bun:test';

import {
  isFullscreenSheetRoute,
  isCenteredSettingsSheetRoute,
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
const WORK_SURFACES = Object.entries(sheetRouteKinds)
  .filter(([, kind]) => kind === 'workSurface')
  .map(([route]) => route);

test('the rule: only a work surface on a Pad is full-screen', () => {
  expect(sheetPresentationFor('workSurface', { isPad: true })).toBe('fullscreen');
  expect(sheetPresentationFor('workSurface', { isPad: false })).toBe('sheet');
  expect(sheetPresentationFor('picker', { isPad: true })).toBe('sheet');
  expect(sheetPresentationFor('picker', { isPad: false })).toBe('sheet');
});

test('every sheet route declares its kind', () => {
  const sheets = Object.entries(sheetRoutePresentations)
    .filter(([, presentation]) => presentation === 'sheet')
    .map(([route]) => route)
    .sort();
  expect(Object.keys(sheetRouteKinds).sort()).toEqual(sheets);
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

test('Android Pad settings leave the host transparent and full-width without changing detents', () => {
  const routes = Object.keys(sheetRouteKinds).filter(
    (route) => route.startsWith('settings-') && sheetRouteKinds[route] === 'picker'
  );
  for (const route of routes) {
    const phone = sheetRouteOptions(route, undefined, false, false, 'android');
    const pad = sheetRouteOptions(route, undefined, false, true, 'android');
    expect(pad.presentation).toBe('formSheet');
    expect(pad.sheetAllowedDetents).toEqual(phone.sheetAllowedDetents);
    expect(pad.sheetGrabberVisible).toBe(true);
    expect(pad.contentStyle).toEqual({ backgroundColor: 'transparent' });
    expect(isCenteredSettingsSheetRoute(route, true, 'android')).toBe(true);
    expect(pad.sheetElevation).toBe(0);
    expect(phone.contentStyle).toEqual({ backgroundColor: 'transparent' });
    expect(sheetRouteOptions(route, undefined, false, true, 'ios')).toEqual(phone);
    expect(sheetRouteOptions(route, undefined, true, true, 'android').animation).toBe('none');
  }
});

test('only Android Pad settings pickers get a centered card and interactive side gutters', () => {
  for (const route of Object.keys(sheetRoutePresentations)) {
    expect(isCenteredSettingsSheetRoute(route, true, 'android')).toBe(
      route.startsWith('settings-') && sheetRouteKinds[route] === 'picker'
    );
    expect(isCenteredSettingsSheetRoute(route, false, 'android')).toBe(false);
    expect(isCenteredSettingsSheetRoute(route, true, 'ios')).toBe(false);
  }
  expect(isCenteredSettingsSheetRoute('settings-unknown', true, 'android')).toBe(false);
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
