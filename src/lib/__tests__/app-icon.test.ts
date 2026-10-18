import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ICONS, appIconFromNative, nativeAppIconName } from '@/lib/app-icon';

describe('app icon catalogue', () => {
  test('the default is the compiled icon, so the native module gets null for it', () => {
    expect(nativeAppIconName('default')).toBeNull();
    expect(nativeAppIconName('Classic')).toBe('Classic');
  });

  test('what the OS reports maps back to a picker value, unknown names included', () => {
    expect(appIconFromNative(null)).toBe('default');
    expect(appIconFromNative(undefined)).toBe('default');
    expect(appIconFromNative('Classic')).toBe('Classic');
    expect(appIconFromNative('Retired')).toBe('default');
  });

  test('every alternate icon round-trips', () => {
    for (const id of APP_ICONS) expect(appIconFromNative(nativeAppIconName(id))).toBe(id);
  });

  test('every selectable native alias has registered artwork on both platforms', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const config = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
    const plugin = config.expo.plugins.find(
      (entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-alternate-app-icons'
    );
    const registered = plugin[1] as {
      name: string;
      ios: string | { light: string; dark: string; tinted: string };
      android: { foregroundImage: string; monochromeImage: string };
    }[];
    expect(registered.map((entry) => entry.name)).toEqual(
      APP_ICONS.filter((id) => id !== 'default')
    );
    for (const entry of registered) {
      const ios = typeof entry.ios === 'string' ? [entry.ios] : Object.values(entry.ios);
      for (const path of [...ios, entry.android.foregroundImage, entry.android.monochromeImage]) {
        expect(existsSync(resolve(root, path))).toBe(true);
      }
    }
  });
});
