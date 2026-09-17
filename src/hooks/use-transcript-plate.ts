import { useMemo } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';

import { appChrome } from '@/constants/appearance';
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
 * `raised` is the nested case -- a tool card inside a message block -- which
 * takes the next surface up so it reads as a card on a card rather than as a
 * floating paragraph.
 */
export function useTranscriptPlate(variant: 'plate' | 'raised' = 'plate'): ViewStyle {
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const fill = variant === 'raised' ? theme.colors.surfaceRaised : theme.colors.surface;
  const border = theme.colors.border;
  return useMemo<ViewStyle>(
    () => ({
      backgroundColor: surfaceBackground(fill),
      borderRadius:
        variant === 'raised' ? appChrome.radius.control : appChrome.radius.transcriptPlate,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    }),
    [surfaceBackground, fill, border, variant]
  );
}
