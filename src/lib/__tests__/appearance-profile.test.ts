import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  appearanceProfiles,
  resolveAppearanceProfile,
  profileNavigationOptions,
  profileThemeOverride,
} from '../appearance-profile';
import { resolveHomeLayout } from '../home-layout';
import { sheetRouteOptions, sheetRoutePresentations } from '../route-presentation';
import { reconcileHomeWorkspaceOwner } from '../home-workspace-owner';

test('released home layouts resolve to one stable, immutable profile, never a second preference', () => {
  for (const id of ['classic', 'editorial', 'mechanical'] as const) {
    const profile = resolveAppearanceProfile(id);
    expect(resolveHomeLayout(id)).toBe(id);
    expect(profile).toBe(appearanceProfiles[id]);
    expect(resolveAppearanceProfile(id)).toBe(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.chrome)).toBe(true);
    expect(profileThemeOverride(profile).radius).toBe(profile.radius);
    expect('colors' in profile).toBe(false);
  }
  for (const unknown of [undefined, null, 'studio', {}, 2]) {
    expect(resolveAppearanceProfile(unknown)).toBe(appearanceProfiles.classic);
  }
});

test('profile native motion stays short, disables animation for reduced motion, and never overrides gestures', () => {
  for (const profile of Object.values(appearanceProfiles)) {
    for (const modal of [false, true]) {
      const options = profileNavigationOptions(profile, false, modal);
      expect(options.animationDuration).toBeLessThanOrEqual(260);
      expect('gestureEnabled' in options).toBe(false);
      expect(profileNavigationOptions(profile, true, modal)).toEqual({
        animation: 'none',
        animationDuration: 0,
      });
    }
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

test('profile wiring keeps route and workspace identities and the shared Home action rail', () => {
  const read = (path: string) => readFileSync(`src/${path}`, 'utf8');
  const root = read('app/_layout.tsx');
  expect(root).toContain('<AppearanceProfileProvider>');
  expect(root).toContain('...pageOptions');
  expect(root).toContain('resolveSheetRouteOptions(route, profile, reduceMotion)');
  expect(root).not.toContain('key={profile');
  const scene = read('components/route-scene.tsx');
  expect(scene.match(/<Animated.View/g)?.length).toBe(1);
  expect(scene).not.toContain('key=');
  const home = read('components/home-overview.tsx');
  expect(home).toContain('onMomentumScrollEnd={rememberScroll}');
  expect(home).toContain('onContentSizeChange={restoreScroll}');
  expect(home).toContain('<HomeMechanicalLayout');
  expect(read('app/index.tsx')).toContain('key={nextWorkspaceOwner}');
  const mechanical = read('components/home-mechanical-layout.tsx');
  expect(mechanical).toContain('getEditorialLayoutGeometry');
  expect(mechanical).not.toContain('react-native-svg');
  expect(read('components/home-launch-actions.tsx')).toContain(
    'showsHorizontalScrollIndicator={false}'
  );
});
