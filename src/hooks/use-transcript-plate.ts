import { useMemo } from 'react';
import type { ViewStyle } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/**
 * The surface a transcript block is read on.
 *
 * The agent timeline has no sheet under it: it draws straight onto the app
 * background, and under an image-backed theme pack that background is an
 * author's photograph. Assistant prose, a thought pill and a shell row painted
 * onto a Santorini wallpaper are not hard to read because the colours are
 * wrong -- `text` and `textMuted` are proven against the theme's *surfaces*,
 * and a photograph is not one of them.
 *
 * So every message block and every tool card takes a surface of its own. It is
 * the same argument as `useSheetGroundPlate`, with one deliberate difference:
 * a sheet's text plate stays opaque because a caption has no other contrast
 * base, while a transcript block goes through `surfaceBackground` and so
 * honours the reader's artwork-opacity slider. Someone who has turned their
 * wallpaper up to show through their cards asked for exactly that, and a plate
 * that ignored the slider would be the one element on screen that did.
 *
 * No border, deliberately. A hairline around every plate turned a message
 * holding a tool card into a frame inside a frame, and a transcript into a
 * stack of boxes. The fill and the gap between rows already say where a block
 * starts; a line around it only competes with the artwork behind it.
 *
 * `raised` takes the next surface up. It is what a tool card fills itself
 * with -- as its own row on the timeline, not as a box inside a message.
 */
export function useTranscriptPlate(variant: 'plate' | 'raised' = 'plate'): ViewStyle {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const fill = variant === 'raised' ? theme.colors.surfaceRaised : theme.colors.surface;
  return useMemo<ViewStyle>(
    () => ({
      backgroundColor: surfaceBackground(fill),
      borderRadius: variant === 'raised' ? profile.chrome.control : profile.chrome.transcriptPlate,
      borderCurve: 'continuous',
    }),
    [surfaceBackground, fill, profile, variant]
  );
}
