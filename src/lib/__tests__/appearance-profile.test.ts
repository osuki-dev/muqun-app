import { expect, test } from 'bun:test';
import {
  appearanceProfiles,
  resolveAppearanceProfile,
  profileNavigationOptions,
  profileThemeOverride,
} from '../appearance-profile';
import { sheetRouteOptions, sheetRoutePresentations } from '../route-presentation';
import { reconcileHomeWorkspaceOwner } from '../home-workspace-owner';

test('released home layouts resolve to stable profiles and unknown layouts use the default', () => {
  for (const id of ['classic', 'editorial'] as const) {
    const profile = resolveAppearanceProfile(id);
    expect(profile).toBe(appearanceProfiles[id]);
    expect(resolveAppearanceProfile(id)).toBe(profile);
    expect(profileThemeOverride(profile).radius).toBe(profile.radius);
  }
  for (const unknown of [undefined, null, 'studio', {}, 2]) {
    expect(resolveAppearanceProfile(unknown)).toBe(appearanceProfiles.editorial);
  }
});

test('profile motion preserves native defaults, reduced motion, and gestures', () => {
  for (const profile of Object.values(appearanceProfiles)) {
    const options = profileNavigationOptions(profile, false);
    expect(options).toEqual({ animation: 'default' });
    expect('gestureEnabled' in options).toBe(false);
    expect(profileNavigationOptions(profile, true)).toEqual({
      animation: 'none',
      animationDuration: 0,
    });
    for (const [route, presentation] of Object.entries(sheetRoutePresentations)) {
      if (presentation !== 'sheet') continue;
      const baseline = sheetRouteOptions(route);
      const options = sheetRouteOptions(route, profile, true);
      expect(options.presentation).toBe('formSheet');
      expect(options.sheetCornerRadius).toBe(profile.chrome.sheet);
      expect(options.sheetAllowedDetents).toEqual(baseline.sheetAllowedDetents);
      expect(options.sheetGrabberVisible).toBe(true);
      expect(options.animation).toBe('none');
      expect(options.gestureEnabled).toBeUndefined();
    }
  }
});

test('all profile switches retain the active Pad task owner, including while Settings covers Home', () => {
  for (const profile of Object.values(appearanceProfiles)) {
    for (const mode of ['compact', 'pad'] as const) {
      expect(
        reconcileHomeWorkspaceOwner('gateway-a', {
          mode,
          loading: false,
          serverId: 'gateway-a',
          preferList: profile.id !== 'classic',
          allowInitialActivation: false,
        })
      ).toBe('gateway-a');
    }
  }
});
