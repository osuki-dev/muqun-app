import type { ThemeDensity, ThemeOverride, ThemeShape } from '@osuki-dev/ui';

/**
 * Muqun's Classic non-colour baseline.
 *
 * Palette packs deliberately do not carry any of these values. The selected
 * pack can therefore recolour the app without also changing its density,
 * corners, opacity or elevation. `lib/appearance-profile.ts` derives the global
 * profile from Home layout, reusing this baseline for Classic. `buildTheme`
 * feeds that profile to the kit; shared chrome uses `useAppearanceProfile`.
 * Unmigrated leaf styles keep these baseline tokens rather than a second setting.
 *
 * `@osuki-dev/ui` currently has provider tokens for radius and three shadows,
 * but no opacity scale and no extension point for app-specific shadow roles.
 * Those extra roles live here until the provider grows that vocabulary.
 */
export const appAppearanceConfig = {
  density: 'compact',
  shape: 'soft',
  radius: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
  },
} as const satisfies {
  density: ThemeDensity;
  shape: ThemeShape;
  radius: Record<string, number>;
};

/** Provider-owned appearance. Kept separate from every theme pack. */
export const appThemeAppearanceOverride = {
  radius: appAppearanceConfig.radius,
} satisfies ThemeOverride;

/**
 * Semantic tokens for app-owned chrome that is not an `@osuki-dev/ui`
 * component. Values intentionally match the existing UI exactly.
 */
export const appChrome = {
  radius: {
    card: appAppearanceConfig.radius.lg,
    control: appAppearanceConfig.radius.md,
    segmentedTrack: 14,
    railItem: 15,
    railAction: 17,
    popover: 18,
    railGlyph: 18,
    segmentedOption: appAppearanceConfig.radius.pill,
    controlTray: 19,
    roundControl: 20,
    noticeCard: 22,
    navigationPill: 23,
    noticeBanner: 24,
    composerField: 25,
    composerDock: 26,
    workspaceRail: 28,
    /**
     * The top corners of a sheet, and of anything that draws a sheet-like top
     * edge over the content behind it (the agent composer dock).
     *
     * One number for both platforms. `route-presentation.ts` hands it to
     * `sheetCornerRadius`, which react-native-screens 4.28 honours on iOS
     * (`UISheetPresentationController.preferredCornerRadius`) and on Android
     * (`ScreenStackFragment.attachShapeToScreen` builds a
     * `MaterialShapeDrawable` from it and the screen clips to its outline).
     * The prop's TSDoc still says `@platform ios`; the Android code path is
     * real and is what this token is verified against on device.
     */
    sheet: 24,
    /**
     * The plate a transcript block sits on.
     *
     * The agent timeline draws onto the app background, which under an
     * image-backed theme pack is an author's photograph. `text` and
     * `textMuted` are proven against the theme's surfaces and never against a
     * picture, so every message block and tool card takes a surface of its own
     * -- the same argument, and deliberately the same number, as
     * `SHEET_GROUND_PLATE_RADIUS`.
     */
    transcriptPlate: 18,
  },
  opacity: {
    disabled: 0.5,
    pressed: 0.76,
    chromeControl: 0.1,
    chromeControlQuiet: 0.06,
    glassSheetTint: 0.6,
    glassFloatingTintLight: 0.26,
    glassFloatingTintDark: 0.34,
    glassAndroidFill: 0.94,
    /**
     * The least opaque a piece of chrome may become when a pack turns its
     * surfaces translucent. The reader's slider still thins the timeline and
     * the sheets' tint; the header pills and the composer dock stop here, so
     * what is typed and what is tapped stays on a frosted floor rather than
     * on the wallpaper.
     */
    glassSolidFloor: 0.82,
    glassLegacyOverlay: 0.2,
    padGutterFill: 0.72,
  },
  layout: {
    /** One physical gutter around both sides of the Pad workspace. */
    padWorkspaceGutter: 12,
  },
  shadow: {
    ambientCard: '0 8px 24px rgba(0, 0, 0, 0.18)',
    connectionPill: '0 6px 16px rgba(0, 0, 0, 0.12)',
    composerDock: '0 -8px 28px rgba(0, 0, 0, 0.18)',
    controlTray: '0 4px 14px rgba(0, 0, 0, 0.16)',
    floatingPill: '0 8px 22px rgba(0, 0, 0, 0.26)',
    notice: '0 8px 28px rgba(0, 0, 0, 0.22)',
    popover: '0 10px 30px rgba(0, 0, 0, 0.24)',
    workspaceRail: '0 10px 30px rgba(0, 0, 0, 0.06)',
  },
} as const;
