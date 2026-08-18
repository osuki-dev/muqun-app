import type { ThemeDensity, ThemeOverride, ThemeShape } from '@osuki-dev/ui';

/**
 * Muqun's non-colour appearance contract.
 *
 * Palette packs deliberately do not carry any of these values. The selected
 * pack can therefore recolour the app without also changing its density,
 * corners, opacity or elevation. `buildTheme` feeds the provider-facing part
 * into `ThemeProvider`; hand-built React Native chrome reads the semantic
 * values below from the same module.
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
    control: appAppearanceConfig.radius.md,
    popover: 18,
    controlTray: 19,
    roundControl: 20,
    noticeCard: 22,
    navigationPill: 23,
    noticeBanner: 24,
    composerField: 25,
    composerDock: 26,
    workspaceRail: 28,
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
