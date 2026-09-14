import { useThemeMode } from '@osuki-dev/ui';

/**
 * The rendered mascot: the one mark the app shows for itself wherever a theme
 * pack has not put its own picture. Home header, tablet rail, lock screen,
 * loaders, Settings and the launch all draw this, and the compiled launch
 * assets in `app.json` are the same two files, so nothing in the app still
 * carries the flat mark it grew up with.
 *
 * Two cuts rather than one with a tint: the dark master is lit for a dark
 * ground and its rim would fringe on a light one. Callers with a theme mode
 * in hand pass it; everything else takes the hook, which follows the mode
 * the app resolved (a theme chosen in Appearance counts, not only the system
 * scheme).
 */
export type BrandMarkMode = 'light' | 'dark';

const BRAND_MARK = {
  light: require('@/assets/images/brand-mark-3d.png'),
  dark: require('@/assets/images/brand-mark-3d-dark.png'),
} as const;

export function brandMark(mode: BrandMarkMode) {
  return mode === 'dark' ? BRAND_MARK.dark : BRAND_MARK.light;
}

export function useBrandMark() {
  const { resolvedMode } = useThemeMode();
  return brandMark(resolvedMode);
}
