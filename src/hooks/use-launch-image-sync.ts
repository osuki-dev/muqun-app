import { SplashScreen } from '@osuki-dev/react-native-splash';
import { useThemeMode } from '@osuki-dev/ui';
import { useEffect } from 'react';

import { useAppliedCustomTheme } from '@/components/theme-candidate';
import { useLaunchArtwork } from '@/hooks/use-launch-artwork';

/**
 * Hands the applied pack's launch picture to the native launch screen.
 *
 * The compiled launch assets are what the OS draws for the first frames of a
 * cold start, and nothing changes that at runtime. Everything after them is
 * ours, and with a pack applied it should already be the pack's: the native
 * overlay that holds the screen until JavaScript is up draws the picture and
 * the paper handed over here, and `useSplashMirror` paints the same frame
 * when JavaScript takes over. Without this, a themed install showed the app's
 * own mark for half a second on every launch and then cross-faded.
 *
 * The shared launch artwork chain: explicit launch artwork, primary Home
 * artwork, then the Home logo. No pack, or a pack
 * without a picture, clears the override and the compiled assets are back.
 *
 * Persisted natively, so it takes effect from the next cold start. Re-run
 * whenever the applied theme or the resolved mode changes: the slot may
 * have a dark variant, and the URI stored is the one for the mode the app is
 * in when it decides.
 */

/** The box the picture is drawn in, shared with `LaunchSceneIntro`. */
export const LAUNCH_ARTWORK_WIDTH_FRACTION = 0.74;
export const LAUNCH_ARTWORK_MAX_WIDTH = 560;

/** A stable contain box shared by native splash and its JavaScript mirror. */
export const LAUNCH_BOX_ASPECT = 1;

export function useLaunchImageSync(): void {
  const artwork = useLaunchArtwork();
  const { theme } = useAppliedCustomTheme();
  const { resolvedMode } = useThemeMode();

  const uri = artwork.kind === 'default' ? null : artwork.uri;
  const kind = artwork.kind;
  const light = theme?.light.colors.background;
  const dark = theme?.dark.colors.background;

  useEffect(() => {
    if (!uri || !light) {
      SplashScreen.clearLaunchImage();
      return;
    }
    SplashScreen.setLaunchImage({
      uri,
      backgroundColor: light,
      darkBackgroundColor: dark,
      widthFraction: LAUNCH_ARTWORK_WIDTH_FRACTION,
      maxWidth: LAUNCH_ARTWORK_MAX_WIDTH,
      aspectRatio: LAUNCH_BOX_ASPECT,
    });
  }, [uri, kind, light, dark, resolvedMode]);
}
