import type { NativeStackNavigationOptions } from 'expo-router';
import type { RadiusToken, ThemeDensity, ThemeOverride, ThemeShape } from '@osuki-dev/ui';

import type { HomeLayout } from '@/lib/home-layout';
import { resolveHomeLayout } from '@/lib/home-layout';
import { appAppearanceConfig, appChrome } from '@/constants/appearance';

export type AppearanceProfileId = HomeLayout;

export type AppearanceProfile = Readonly<{
  id: AppearanceProfileId;
  density: ThemeDensity;
  shape: ThemeShape;
  radius: Readonly<Record<'none' | 'xs' | 'sm' | 'md' | 'lg' | 'pill', number>>;
  chrome: Readonly<{
    card: number;
    control: number;
    roundControl: number;
    popover: number;
    controlTray: number;
    noticeCard: number;
    navigationPill: number;
    noticeBanner: number;
    composerField: number;
    composerDock: number;
    workspaceRail: number;
    railGlyph: number;
    railAction: number;
    railItem: number;
    segmentedTrack: number;
    segmentedOption: number;
    sheet: number;
    transcriptPlate: number;
    overlay: number;
    surface: number;
  }>;
  rail: Readonly<{
    showsDivider: boolean;
    contentGap: number;
    actionsShowDivider: boolean;
    actionsPaddingTop: number;
    workbenchMarginHorizontal: number;
    selectionBarWidth: number;
    selectionPaddingLeft: number;
    brandIconRadius: number;
    itemIconRadius: number;
    brandTitleFontSize?: number;
    brandTitleLineHeight?: number;
    brandTitleLetterSpacing?: number;
    showsTagline: boolean;
  }>;
  settingsRowPaddingVertical: number;
  navigation: Readonly<Pick<NativeStackNavigationOptions, 'animation'>>;
  motion: Readonly<{
    revealMs: number;
    revealDistance: number;
    pressedScale: number;
  }>;
  rowPaddingVertical: number;
}>;

const classic: AppearanceProfile = {
  id: 'classic',
  density: appAppearanceConfig.density,
  shape: appAppearanceConfig.shape,
  radius: appAppearanceConfig.radius,
  chrome: {
    card: appChrome.radius.card,
    control: appChrome.radius.control,
    roundControl: appChrome.radius.roundControl,
    popover: appChrome.radius.popover,
    controlTray: appChrome.radius.controlTray,
    noticeCard: appChrome.radius.noticeCard,
    navigationPill: appChrome.radius.navigationPill,
    noticeBanner: appChrome.radius.noticeBanner,
    composerField: appChrome.radius.composerField,
    composerDock: appChrome.radius.composerDock,
    workspaceRail: appChrome.radius.workspaceRail,
    railGlyph: appChrome.radius.railGlyph,
    railAction: appChrome.radius.railAction,
    railItem: appChrome.radius.railItem,
    segmentedTrack: appChrome.radius.segmentedTrack,
    segmentedOption: appChrome.radius.segmentedOption,
    sheet: appChrome.radius.sheet,
    transcriptPlate: appChrome.radius.transcriptPlate,
    overlay: appChrome.radius.noticeBanner,
    surface: appChrome.radius.transcriptPlate,
  },
  rail: {
    showsDivider: false,
    contentGap: 20,
    actionsShowDivider: false,
    actionsPaddingTop: 10,
    workbenchMarginHorizontal: 0,
    selectionBarWidth: 0,
    selectionPaddingLeft: 10,
    brandIconRadius: 15,
    itemIconRadius: 17,
    showsTagline: true,
  },
  settingsRowPaddingVertical: 12,
  navigation: { animation: 'default' },
  motion: { revealMs: 240, revealDistance: 8, pressedScale: 0.985 },
  rowPaddingVertical: 8,
};

const editorial: AppearanceProfile = {
  id: 'editorial',
  density: 'compact',
  shape: 'soft',
  radius: { none: 0, xs: 0, sm: 2, md: 4, lg: 8, pill: 999 },
  chrome: {
    card: 4,
    control: 4,
    roundControl: 4,
    popover: 6,
    controlTray: 6,
    noticeCard: 6,
    navigationPill: 6,
    noticeBanner: 6,
    composerField: 4,
    composerDock: 8,
    workspaceRail: 8,
    railGlyph: 4,
    railAction: 4,
    railItem: 4,
    segmentedTrack: 4,
    segmentedOption: 2,
    sheet: 8,
    transcriptPlate: 4,
    overlay: 6,
    surface: 4,
  },
  rail: {
    showsDivider: true,
    contentGap: 24,
    actionsShowDivider: true,
    actionsPaddingTop: 12,
    workbenchMarginHorizontal: 10,
    selectionBarWidth: 3,
    selectionPaddingLeft: 7,
    brandIconRadius: 4,
    itemIconRadius: 4,
    brandTitleFontSize: 32,
    brandTitleLineHeight: 36,
    brandTitleLetterSpacing: -1,
    showsTagline: false,
  },
  settingsRowPaddingVertical: 10,
  // Native presentation owns route motion, duration and back gestures.
  navigation: { animation: 'default' },
  motion: { revealMs: 200, revealDistance: 4, pressedScale: 0.99 },
  rowPaddingVertical: 10,
};

export const appearanceProfiles: Readonly<Record<AppearanceProfileId, AppearanceProfile>> = {
  classic,
  editorial,
};

// Profile changes are rare. Stable, immutable objects can cross context/native
// boundaries without allocating a new token tree on unrelated settings updates.
for (const profile of Object.values(appearanceProfiles)) {
  Object.freeze(profile.radius);
  Object.freeze(profile.chrome);
  Object.freeze(profile.rail);
  Object.freeze(profile.navigation);
  Object.freeze(profile.motion);
  Object.freeze(profile);
}
Object.freeze(appearanceProfiles);

/** `homeLayout` is the sole persisted source for app geometry and motion. */
export function resolveAppearanceProfile(value: unknown): AppearanceProfile {
  return appearanceProfiles[resolveHomeLayout(value)];
}

/**
 * The profile as kit theme tokens, so kit components take its geometry and
 * press motion without a wrapper.
 *
 * Component radii are token names, not numbers, so each chrome radius is named
 * by the step of the profile's own ladder that holds it. Every `Card` follows
 * `chrome.card` whatever its `radius` prop asks for, as the app's cards always
 * have. `Tabs` is the app's segmented control (`SettingsSegmented`), so it
 * takes the segmented track radius.
 *
 * `decorated` is a custom theme pack being worn: its artwork or a translucent
 * ground can sit under a ghost button, so the ghost keeps a raised base under
 * its label instead of none.
 */
export function profileThemeOverride(profile: AppearanceProfile, decorated = false): ThemeOverride {
  const token = (value: number) => radiusToken(profile, value);
  const card = token(profile.chrome.card);
  return {
    radius: profile.radius,
    components: {
      Button: {
        radius: token(profile.chrome.control),
        ...(decorated ? { ghost: { background: 'surfaceRaised' } } : {}),
      },
      Card: { radius: { none: card, xs: card, sm: card, md: card, lg: card } },
      Tabs: { radius: token(profile.chrome.segmentedTrack) },
      SegmentedControl: {
        radius: token(profile.chrome.segmentedTrack),
        optionRadius: token(profile.chrome.segmentedOption),
      },
    },
    // The kit's press timings and springs are the app's own (`PRESS`,
    // `kitButtonPressMotion`); only the resting scale differs by profile.
    motion: { press: { surface: profile.motion.pressedScale } },
  } satisfies ThemeOverride;
}

/** The step of the profile's radius ladder that is `value` points. */
function radiusToken(profile: AppearanceProfile, value: number): RadiusToken {
  const tokens = Object.keys(profile.radius) as RadiusToken[];
  const match = tokens.find((key) => profile.radius[key] === value);
  if (!match) throw new Error(`Appearance profile ${profile.id} has no ${value}pt radius step`);
  return match;
}

/** Native options only: profiles never replace Stack ownership or gestures. */
export function profileNavigationOptions(
  profile: AppearanceProfile,
  reduceMotion: boolean
): Pick<NativeStackNavigationOptions, 'animation' | 'animationDuration'> {
  if (reduceMotion) return { animation: 'none', animationDuration: 0 };
  return { animation: profile.navigation.animation };
}
