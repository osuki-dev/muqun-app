import { useThemeMode } from '@osuki-dev/ui';
import { useCallback } from 'react';

import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { surfaceBackgroundFill, surfaceBackgroundOpacity } from '@/theme/surface-background';

export function useSurfaceBackgroundOpacity() {
  const { resolvedMode } = useThemeMode();
  const { theme } = useEffectiveCustomTheme();
  return surfaceBackgroundOpacity(
    theme?.manifest.variants[resolvedMode].surfaces?.backgroundOpacity
  );
}

/**
 * The fill for a coloured surface, at the theme's "Interface background
 * opacity" (Settings -> Theme; 1 = opaque, stored per installed theme).
 *
 * Every content surface goes through this: a coloured background that carries
 * text or controls and sits over other content or the wallpaper -- sheets'
 * frost, menus and popovers, trays, banners and notices, cards, chips, pills,
 * toolbars, list rows with a fill, composer popups, Pad panels. A surface that
 * floats over live content may keep a legibility floor under the slider,
 * `Math.max(opacity, floor)`, as `GlassChrome`'s solid material and
 * `sheetFrostAlpha` do.
 *
 * What deliberately bypasses it (each such site says so in an "Opacity audit"
 * comment):
 * - **Floors**: the single opaque base of a full screen or sheet
 *   (`route-scene.tsx`, `SheetGround`'s first layer, the terminal backdrop).
 *   Without it the previous route shows through.
 * - **Safety screens**: the error boundary, the app lock, the pairing camera's
 *   shutter.
 * - **Decorative tints and scrims**: `chromeControl` highlights, pressed states,
 *   dim scrims, `padGutterFill`, selection rules, artwork placeholders.
 * - **Glass**: `GlassChrome`'s glass tints and Android glass fallback are the
 *   pack's explicit material.
 */
export function useSurfaceBackground() {
  const opacity = useSurfaceBackgroundOpacity();
  return useCallback((color: string) => surfaceBackgroundFill(color, opacity), [opacity]);
}
