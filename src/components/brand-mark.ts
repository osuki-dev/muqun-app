import { useActiveAppIcon } from '@/hooks/use-app-icon';
import { type AppIconId, appIconDirectory } from '@/lib/app-icon';

/**
 * The in-app brand mark follows the launcher icon in effect, so the app does
 * not introduce itself with a different face than the home screen shows.
 * Keyed by the catalog's artwork folder (`assets/icons/<directory>`), because
 * Metro needs a static `require` for each file. Every mark is a 512px canvas
 * with a real alpha channel and the same margin, so each site's size and
 * `contentFit` hold whichever icon is chosen; full-bleed icons are cut as a
 * rounded tile rather than an opaque square.
 */
const BRAND_MARKS: Record<string, number> = {
  classic: require('@/assets/icons/classic/brand-mark.png'),
  mascot: require('@/assets/icons/mascot/brand-mark.png'),
  cyber: require('@/assets/icons/cyber/brand-mark.png'),
  anime: require('@/assets/icons/anime/brand-mark.png'),
  arcade: require('@/assets/icons/arcade/brand-mark.png'),
  mint: require('@/assets/icons/mint/brand-mark.png'),
  sakura: require('@/assets/icons/sakura/brand-mark.png'),
};

export function brandMarkFor(icon: AppIconId): number {
  return BRAND_MARKS[appIconDirectory(icon)] ?? BRAND_MARKS[appIconDirectory('default')];
}

export function useBrandMark(): number {
  return brandMarkFor(useActiveAppIcon());
}
