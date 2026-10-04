import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import config from '../../../app.json';

test('iPad supports resizable portrait and landscape without changing phone orientation', () => {
  const ios = config.expo.ios;
  expect(ios.supportsTablet).toBe(true);
  expect(ios.requireFullScreen).toBe(false);
  expect(ios.infoPlist.UISupportedInterfaceOrientations).toEqual([
    'UIInterfaceOrientationPortrait',
  ]);
  expect(ios.infoPlist['UISupportedInterfaceOrientations~ipad']).toEqual([
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]);
  expect(ios.bundleIdentifier).toBe('dev.osuki.muqun');
});

test('runtime iPad orientation does not reinstate the former landscape lock', () => {
  const root = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
  expect(root).toContain("Platform.OS === 'ios' && deviceType === Device.DeviceType.TABLET");
  expect(root).toContain('return ScreenOrientation.unlockAsync()');
});
