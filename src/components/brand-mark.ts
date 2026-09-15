import { useThemeMode } from '@osuki-dev/ui';

/** The original Classic mark is the default on both light and dark surfaces.
 * The launcher choice remains independent of in-app theme customisation.
 */
export type BrandMarkMode = 'light' | 'dark';

const BRAND_MARK = {
  light: require('@/assets/icons/classic/brand-mark.png'),
  dark: require('@/assets/icons/classic/brand-mark.png'),
} as const;

export function brandMark(mode: BrandMarkMode) {
  return mode === 'dark' ? BRAND_MARK.dark : BRAND_MARK.light;
}

export function useBrandMark() {
  const { resolvedMode } = useThemeMode();
  return brandMark(resolvedMode);
}
