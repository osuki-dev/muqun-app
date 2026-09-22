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

import {
  resolveAppearanceProfile,
  profileThemeOverride,
  type AppearanceProfile,
} from '@/lib/appearance-profile';
import {
  DEFAULT_THEME_PACK_ID,
  resolveThemePack,
  type ThemeAppearance,
} from '@/constants/theme-packs';
import { userFontRegistry } from '@/theme/interface-font-registry';
import { slotFontFamily, SYSTEM_FONT_SLOT, type FontSlot } from '@/theme/user-font-file';

/**
 * The shape of the app, independent of its colours: density, corner radius and
 * tone are Muqun's, not the theme's. A pack changes what the app is coloured
 * with, never how tightly it is packed -- otherwise picking Tokyo Night would
 * silently re-lay-out every screen.
 */
export function buildTheme(
  pack: ThemeAppearance,
  /**
   * The face the app's own text is set in, where the reader has supplied one.
   *
   * A second argument rather than a second lookup inside this function, because
   * this is also what the theme preview route builds its nested provider with:
   * a preview is the app wearing another palette, and it has to be wearing the
   * reader's font while it does it or it is previewing a different app.
   *
   * Independent of the pack on purpose. A pack is colour -- `theme/schema.ts`
   * has no font field and the authoring skill forbids one -- so a font survives
   * every theme change, which is the only behaviour that makes sense for a
   * reader who chose a face because they can read it.
   */
  interfaceFont: FontSlot = SYSTEM_FONT_SLOT,
  profile: AppearanceProfile = resolveAppearanceProfile('classic')
): ThemeOverride {
  const preset = createThemePreset({
    name: `muqun-${pack.id}`,
    tone: 'commerce',
    density: profile.density,
    shape: profile.shape,
    light: pack.light.colors,
    dark: pack.dark.colors,
  });

  /**
   * Every role the kit has, including `label`.
   *
   * `display` and `body` are the app's *reading*: a title, a row, a caption, a
   * message. `label` is the 11pt all-caps instrument style the section
   * headings are set in -- SERVERS, APPEARANCE, TERMINAL -- and it was left on
   * the system face for a while on the argument that it is chrome rather than
   * content. It reads as two fonts in one line, so it follows the reader now:
   * the instrument style (size, tracking, case) is the role's, the face is
   * theirs. These three are the whole of `typeStyles`, so covering them covers
   * every variant the kit can draw -- `hero` and `display` from `display`,
   * `heading` through `bodySmall` from `body`, and `caption`, `label`,
   * `data`, `dataLarge` and `button` from `label`.
   */
  const interfaceFamily = slotFontFamily(interfaceFont, 'interface');
  const fonts = interfaceFamily
    ? { ...preset.fonts, ...userFontRegistry(interfaceFamily) }
    : preset.fonts;

  return {
    ...preset,
    ...profileThemeOverride(profile),
    ...(fonts ? { fonts } : {}),
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
