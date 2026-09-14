import { useThemeMode } from '@osuki-dev/ui';
import { useWindowDimensions } from 'react-native';

import { useAppliedCustomTheme } from '@/components/theme-candidate';
import {
  resolveLaunchArtwork,
  resolveLaunchBackground,
  type LaunchArtwork,
} from '@/theme/launch-artwork';

/**
 * The picture the launch overlay and the lock screen show for the applied pack.
 *
 * The decision itself is `resolveLaunchArtwork`, which is pure and has its own
 * tests. This is only the wiring: the installation's asset map, the resolved
 * mode, and the window's width class -- read exactly the way `ThemeArtwork`
 * reads them, so a launch screen and the home screen never disagree about
 * which asset a slot points at.
 *
 * `useAppliedCustomTheme`, deliberately, and not `useEffectiveCustomTheme`.
 * These two surfaces draw the app itself rather than a route: the overlay
 * covers everything while the router is still starting, and the lock gate sits
 * above the whole stack. Neither can be inside a `CandidateThemeProvider`, and
 * neither should follow one if some future screen puts it there -- a splash
 * that wore whichever theme was last previewed would be the app showing a
 * decision the reader has not made.
 */
export function useLaunchArtwork(): LaunchArtwork {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const { theme, assets } = useAppliedCustomTheme();
  return resolveLaunchArtwork(theme, assets, resolvedMode, width >= 768 ? 'regular' : 'compact');
}

/**
 * The launch overlay's picture: the pack's `home.hero` when it drew one, else
 * the same chain as {@link useLaunchArtwork}. Separate from the lock screen's
 * hook because a hero is a wide banner and the lock frame is a square badge;
 * everything else about the wiring is identical, including which theme counts.
 */
export function useLaunchHeroArtwork(): LaunchArtwork {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const { theme, assets } = useAppliedCustomTheme();
  return resolveLaunchArtwork(theme, assets, resolvedMode, width >= 768 ? 'regular' : 'compact', {
    hero: true,
  });
}

/** The applied pack's own paper for the launch overlay, or null to keep the app's. */
export function useLaunchBackground(): string | null {
  const { resolvedMode } = useThemeMode();
  const { theme } = useAppliedCustomTheme();
  return resolveLaunchBackground(theme, resolvedMode);
}
