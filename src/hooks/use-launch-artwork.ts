import { useThemeMode } from '@osuki-dev/ui';
import { useWindowDimensions } from 'react-native';

import { useThemeLibrary } from '@/stores/theme-library';
import {
  resolveLaunchArtwork,
  resolveLaunchBackground,
  type LaunchArtwork,
} from '@/theme/launch-artwork';

/**
 * The picture the launch overlay and the lock screen show for the active pack.
 *
 * The decision itself is `resolveLaunchArtwork`, which is pure and has its own
 * tests. This is only the wiring: the installation's asset map, the resolved
 * mode, and the window's width class -- read exactly the way `ThemeArtwork`
 * reads them, so a launch screen and the home screen never disagree about
 * which asset a slot points at.
 */
export function useLaunchArtwork(): LaunchArtwork {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  return resolveLaunchArtwork(active, assets, resolvedMode, width >= 768 ? 'regular' : 'compact');
}

/** The pack's own paper for the launch overlay, or null to keep the app's. */
export function useLaunchBackground(): string | null {
  const { resolvedMode } = useThemeMode();
  const active = useThemeLibrary((state) => state.active);
  return resolveLaunchBackground(active, resolvedMode);
}
