import { useThemeMode } from '@osuki-dev/ui';

import { resolveThemePack, type ThemePack } from '@/constants/theme-packs';
import { createTerminalTheme, type TerminalTheme } from '@/terminal/palette';
import { useAppSettings } from '@/stores/app-settings';

/**
 * The pack the app is currently wearing.
 *
 * Resolution happens here, on the JS thread, and hands back one of the frozen
 * module constants from the registry -- so the result is referentially stable
 * for as long as the choice is, and anything memoising on it re-runs exactly
 * when the theme changes and not once more.
 */
export function useThemePack(): ThemePack {
  const themePack = useAppSettings((state) => state.themePack);
  return resolveThemePack(themePack);
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
