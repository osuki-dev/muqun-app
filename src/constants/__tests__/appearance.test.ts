import { describe, expect, test } from 'bun:test';

import { appAppearanceConfig, appChrome, appThemeAppearanceOverride } from '../appearance';

describe('app appearance contract', () => {
  test('the provider and app chrome share the same radius source', () => {
    expect(appThemeAppearanceOverride.radius).toBe(appAppearanceConfig.radius);
    expect(appChrome.radius.control).toBe(appAppearanceConfig.radius.md);
  });

  test('the current contract preserves the shipped geometry and elevation', () => {
    expect(appAppearanceConfig).toEqual({
      density: 'compact',
      shape: 'soft',
      radius: { none: 0, xs: 4, sm: 8, md: 12, lg: 16, pill: 999 },
    });
    expect(appChrome.shadow).toEqual({
      ambientCard: '0 8px 24px rgba(0, 0, 0, 0.18)',
      connectionPill: '0 6px 16px rgba(0, 0, 0, 0.12)',
      composerDock: '0 -8px 28px rgba(0, 0, 0, 0.18)',
      controlTray: '0 4px 14px rgba(0, 0, 0, 0.16)',
      floatingPill: '0 8px 22px rgba(0, 0, 0, 0.26)',
      notice: '0 8px 28px rgba(0, 0, 0, 0.22)',
      popover: '0 10px 30px rgba(0, 0, 0, 0.24)',
      workspaceRail: '0 10px 30px rgba(0, 0, 0, 0.06)',
    });
  });

  test('glass fallbacks and Pad shell geometry have one app-owned source', () => {
    expect(appChrome.opacity.glassAndroidFill).toBe(0.94);
    expect(appChrome.opacity.glassLegacyOverlay).toBe(0.2);
    expect(appChrome.opacity.padGutterFill).toBe(0.72);
    expect(appChrome.layout).toEqual({ padWorkspaceGutter: 12 });
    expect(appChrome.radius.workspaceRail).toBe(28);
  });
});
