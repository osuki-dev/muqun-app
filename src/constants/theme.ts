/**
 * The app's colour system.
 *
 * Every colour the UI draws comes from here, through the `@osuki-dev/ui`
 * `ThemeProvider` in `app/_layout.tsx` and the `useThemeTokens()` hook. What
 * used to be one hand-authored palette is now a *selected* one: the values live
 * in `theme-packs.ts`, and this file's only job is turning the chosen pack into
 * the `ThemeOverride` the library expects.
 *
 * Where a pack names a role the library does not carry -- `accent-pressed`,
 * `interactive-pressed` -- the role is dropped rather than invented: nothing in
 * this app draws a pressed fill, and an unused token is a token that drifts.
 */

import '@/global.css';

import { createThemePreset, type ThemeOverride } from '@osuki-dev/ui';

import { appAppearanceConfig, appThemeAppearanceOverride } from '@/constants/appearance';
import { DEFAULT_THEME_PACK_ID, resolveThemePack, type ThemePack } from '@/constants/theme-packs';

/**
 * The shape of the app, independent of its colours: density, corner radius and
 * tone are Muqun's, not the theme's. A pack changes what the app is coloured
 * with, never how tightly it is packed -- otherwise picking Tokyo Night would
 * silently re-lay-out every screen.
 */
export function buildTheme(pack: ThemePack): ThemeOverride {
  const preset = createThemePreset({
    name: `muqun-${pack.id}`,
    tone: 'commerce',
    density: appAppearanceConfig.density,
    shape: appAppearanceConfig.shape,
    light: pack.light.colors,
    dark: pack.dark.colors,
  });

  return {
    ...preset,
    ...appThemeAppearanceOverride,
    components: {
      ...preset.components,
      Input: {
        ...preset.components?.Input,
        // The library points this at `textDisabled`, which measures under 2:1
        // on a field. Placeholder text here names the agent being messaged, so
        // it is content, and content is held to the muted tier.
        placeholder: 'textMuted',
      },
    },
  };
}

const defaultPack = resolveThemePack(DEFAULT_THEME_PACK_ID);

/**
 * The default theme, built once. Still exported under its old name because it
 * is what the provider shows before settings have hydrated, and what anything
 * outside the React tree should assume.
 */
export const muqunTheme: ThemeOverride = buildTheme(defaultPack);

/**
 * The splash and the app's first painted frame have to agree, or the handover
 * flashes. Native config (`app.json`) carries its own copy of these two, since
 * it is read before any JS runs -- which is also why this stays on the default
 * pack: the native splash cannot know which theme was picked.
 */
export const SplashBackground = {
  light: defaultPack.light.colors.background,
  dark: defaultPack.dark.colors.background,
} as const;
