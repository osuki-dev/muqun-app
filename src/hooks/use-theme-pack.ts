import { useThemeMode, type ThemeOverride } from '@osuki-dev/ui';
import { useMemo } from 'react';

import { buildTheme } from '@/constants/theme';
import { resolveThemePack, type ThemeAppearance } from '@/constants/theme-packs';
import { createTerminalTheme, type TerminalTheme } from '@/terminal/palette';
import { useAppSettings } from '@/stores/app-settings';
import { useThemeLibrary } from '@/stores/theme-library';

/**
 * The pack the app is currently wearing.
 *
 * Resolution happens here, on the JS thread, and hands back one of the frozen
 * module constants from the registry -- so the result is referentially stable
 * for as long as the choice is, and anything memoising on it re-runs exactly
 * when the theme changes and not once more.
 */
export function useThemePack(): ThemeAppearance {
  const themePack = useAppSettings((state) => state.themePack);
  const custom = useThemeLibrary((state) => state.active);
  const selection = useThemeLibrary((state) => state.library.selection);
  return custom ?? resolveThemePack(selection?.kind === 'builtin' ? selection.id : themePack);
}

/**
 * The palette a pack hands the kit's `ThemeProvider`.
 *
 * Two providers need this now: the root one in `app/_layout.tsx`, whose pack is
 * whatever the app is wearing, and the nested one in the theme preview route,
 * whose pack is the theme being looked at. Both are the same sentence --
 * `buildTheme` over a `ThemeAppearance` -- and a second copy of it is a second
 * place for the preview to stop matching the app it is previewing.
 *
 * Memoised on the pack itself, which the registry and `compileTheme` both keep
 * referentially stable, so the provider rebuilds its tokens exactly when the
 * theme changes and not once more.
 */
export function useThemePalette(pack: ThemeAppearance): ThemeOverride {
  // The reader's interface font is part of the palette the provider is handed,
  // so it is part of what the memo watches. Without it here a font installed
  // while the app is running would be written to the store, re-render every
  // consumer of the setting, and change nothing: the provider would hand out
  // the tokens it built the last time the *pack* changed.
  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  return useMemo(() => buildTheme(pack, interfaceFont), [pack, interfaceFont]);
}

/**
 * The terminal's own colours for the pack and mode showing right now.
 *
 * Every terminal surface reads this rather than reaching for app tokens: the
 * terminal palette is published by the theme's own project, and mixing it with
 * `useThemeTokens()` is how the two used to disagree about red.
 */
export function useTerminalTheme(): TerminalTheme {
  const pack = useThemePack();
  const { resolvedMode } = useThemeMode();
  return createTerminalTheme(pack, resolvedMode);
}
