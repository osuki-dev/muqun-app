import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import config from '../../../app.json';

test('iPad is landscape-only and full-screen, phones stay portrait', () => {
  const ios = config.expo.ios;
  expect(ios.supportsTablet).toBe(true);
  // Apple only accepts an iPad app without all four orientations when it opts out of multitasking.
  expect(ios.requireFullScreen).toBe(true);
  expect(ios.infoPlist.UISupportedInterfaceOrientations).toEqual([
    'UIInterfaceOrientationPortrait',
  ]);
  expect(ios.infoPlist['UISupportedInterfaceOrientations~ipad']).toEqual([
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]);
  expect(ios.bundleIdentifier).toBe('dev.osuki.muqun');
});

test('Android locks orientation at module scope from the screen metrics', () => {
  const root = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
  expect(root).toContain("Dimensions.get('screen')");
  expect(root).toContain('orientationPolicy(width, height)');
  expect(root).toContain('ScreenOrientation.OrientationLock.PORTRAIT_UP');
  expect(config.expo.orientation).toBe('default');
  expect(config.expo.plugins).not.toContain('./plugins/with-pad-landscape.js');
});
