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
import { appChrome } from '../../constants/appearance';

test('released home layouts resolve to one stable, immutable profile, never a second preference', () => {
  for (const id of ['classic', 'editorial'] as const) {
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

test('Classic semantic geometry is encoded in the profile rather than component branches', () => {
  const { chrome } = appearanceProfiles.classic;
  expect(chrome.card).toBe(appChrome.radius.card);
  expect(chrome.control).toBe(appChrome.radius.control);
  expect(chrome.popover).toBe(appChrome.radius.popover);
  expect(chrome.noticeCard).toBe(appChrome.radius.noticeCard);
  expect(chrome.navigationPill).toBe(appChrome.radius.navigationPill);
  expect(chrome.noticeBanner).toBe(appChrome.radius.noticeBanner);
  expect(chrome.composerField).toBe(appChrome.radius.composerField);
  expect(chrome.composerDock).toBe(appChrome.radius.composerDock);
  expect(chrome.workspaceRail).toBe(appChrome.radius.workspaceRail);
  expect(chrome.railGlyph).toBe(appChrome.radius.railGlyph);
  expect(chrome.railAction).toBe(appChrome.radius.railAction);
  expect(chrome.railItem).toBe(appChrome.radius.railItem);
  expect(chrome.segmentedTrack).toBe(appChrome.radius.segmentedTrack);
  expect(chrome.segmentedOption).toBe(appChrome.radius.segmentedOption);
  expect(chrome.sheet).toBe(appChrome.radius.sheet);
  expect(chrome.transcriptPlate).toBe(appChrome.radius.transcriptPlate);
});

test('Editorial keeps its magazine layout with the compact corner treatment', () => {
  const { radius, chrome } = appearanceProfiles.editorial;
  expect(radius).toEqual({ none: 0, xs: 0, sm: 2, md: 4, lg: 8, pill: 999 });
  expect(chrome).toMatchObject({
    card: 4,
    control: 4,
    popover: 6,
    noticeCard: 6,
    composerDock: 8,
    sheet: 8,
    surface: 4,
  });
});

test('profile motion preserves native defaults, reduced motion, and gestures', () => {
  for (const profile of Object.values(appearanceProfiles)) {
    for (const modal of [false, true]) {
      const options = profileNavigationOptions(profile, false, modal);
      if (profile.id === 'editorial') {
        expect(options).toEqual({ animation: 'default' });
      } else {
        expect(options.animationDuration).toBeLessThanOrEqual(260);
      }
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
  expect(home).toContain('<HomeEditorialLayout');
  expect(read('app/index.tsx')).toContain('key={nextWorkspaceOwner}');
  expect(read('components/home-launch-actions.tsx')).toContain(
    'showsHorizontalScrollIndicator={false}'
  );
});

test('shared surface seams consume semantic profile geometry without profile-ID branches', () => {
  const read = (path: string) => readFileSync(`src/${path}`, 'utf8');
  const seams = {
    'components/settings-chrome.tsx': ['profile.chrome.surface', 'profile.chrome.control'],
    'hooks/use-transcript-plate.ts': ['profile.chrome.transcriptPlate', 'profile.chrome.control'],
    'components/pad-server-rail.tsx': [
      'profile.chrome.workspaceRail',
      'profile.chrome.railGlyph',
      'profile.chrome.railAction',
      'profile.chrome.railItem',
    ],
    'components/terminal-composer.tsx': ['profile.chrome.composerField'],
    'components/agent-action-menu.tsx': ['profile.chrome.popover'],
    'components/attachment-menu.tsx': ['profile.chrome.popover'],
    'components/file-mention-panel.tsx': ['profile.chrome.popover'],
    'components/agent-mode-menu.tsx': ['profile.chrome.popover', 'profile.chrome.control'],
    'components/themed-card.tsx': ['profile.chrome.card'],
    'components/settings-segmented.tsx': [
      'profile.chrome.segmentedTrack',
      'profile.chrome.segmentedOption',
    ],
  } as const;

  for (const [path, tokens] of Object.entries(seams)) {
    const source = read(path);
    expect(source).toContain('useAppearanceProfile');
    expect(source).not.toContain('profile.id');
    for (const token of tokens) expect(source).toContain(token);
  }

  const glass = read('components/glass-chrome.tsx');
  expect(glass).toContain("shape?: keyof AppearanceProfile['chrome'] | 'pill' | 'none'");
  expect(glass).toContain('profile.chrome[resolvedShape]');
  expect(glass).not.toContain("profile.id !== 'classic'");
});
