import { describe, expect, test } from 'bun:test';

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
});
