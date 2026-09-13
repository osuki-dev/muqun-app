import { useThemeMode } from '@osuki-dev/ui';
import { useCallback } from 'react';

import { useThemeLibrary } from '@/stores/theme-library';
import { surfaceBackgroundFill, surfaceBackgroundOpacity } from '@/theme/surface-background';

export function useSurfaceBackgroundOpacity() {
  const { resolvedMode } = useThemeMode();
  return useThemeLibrary((state) =>
    surfaceBackgroundOpacity(
      state.active?.manifest.variants[resolvedMode].surfaces?.backgroundOpacity
    )
  );
}

/** Explicitly opt a colored surface into the custom theme's background preference. */
export function useSurfaceBackground() {
  const opacity = useSurfaceBackgroundOpacity();
  return useCallback((color: string) => surfaceBackgroundFill(color, opacity), [opacity]);
}
