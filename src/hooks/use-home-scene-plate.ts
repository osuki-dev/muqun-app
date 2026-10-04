import { useThemeTokens } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { SheetGroundPlate } from '@/components/sheet-ground';
import { useHasThemeArtwork } from '@/components/theme-artwork';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/** Frozen and shared, so a plateless render commits the same object every time. */
// Typed as the plate's six properties, not `ViewStyle`: a plate goes on a
// `Text` as well as a `View`, and the two style types disagree on `userSelect`.
const NO_PLATE: SheetGroundPlate = Object.freeze({});

/**
 * The plate under Home text that stands straight on a pack's scene.
 *
 * Home's section headings ("Continue", "Connections") have had one since packs
 * could paint the Home wallpaper; the empty-state captions under them did not,
 * so on the built-in Cover Courier "Nothing to show yet" was `textMuted`
 * straight on the bridge drawing. One hook, so a heading and the caption under
 * it are the same shape: `surface` through the reader's opacity slider (the
 * ground tint, which follows light and dark), the control radius, 8 by 4.
 *
 * Empty where there is no scene: a flat ground keeps exactly its old layout.
 */
export function useHomeScenePlate(): SheetGroundPlate {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const hasScene = useHasThemeArtwork('home.wallpaper', 'shell.wallpaper');
  if (!hasScene) return NO_PLATE;
  return {
    alignSelf: 'flex-start',
    backgroundColor: background(theme.colors.surface),
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: profile.chrome.control,
    borderCurve: 'continuous',
  };
}
