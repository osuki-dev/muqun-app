import { useThemeMode, type TabsLayering } from '@osuki-dev/ui';
import { useCallback } from 'react';

import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import {
  sheetFrostAlpha,
  surfaceBackgroundFill,
  surfaceBackgroundOpacity,
} from '@/theme/surface-background';

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
 * `sheetFrostAlpha` do; popups and menus over the terminal or transcript use
 * `useFloatingSurfaceBackground` below for exactly that.
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

/**
 * The fill for a panel that floats over live content: the composer's command
 * and mention popups, its attachment and mode menus, the queued-prompt inbox,
 * the revert plate, a popover action menu. These follow the slider like any
 * surface but never thinner than `sheetFrostAlpha`'s legibility floor -- under
 * them is a terminal or a transcript still moving, not a wallpaper, and rows
 * of text over rows of text stop being readable long before a card over a
 * picture does. Opaque at the default 1, like every other surface.
 */
export function useFloatingSurfaceBackground() {
  const opacity = useSurfaceBackgroundOpacity();
  return useCallback(
    (color: string) => surfaceBackgroundFill(color, sheetFrostAlpha(opacity)),
    [opacity]
  );
}

/**
 * How a pill `Tabs` lays its fills at the theme's surface opacity.
 *
 * Opaque, the kit paints the track once and the selection over it. Below full
 * opacity a selection stacked on a translucent track shows the wallpaper at
 * `(1 - a)²` against the track's `1 - a`, so the selected pill reads as the one
 * control that ignored the setting; `segments` leaves the list clear and each
 * trigger carries one fill, which `AppSurfaceDecorator` thins like any surface.
 */
export function usePillTabsLayering(): TabsLayering {
  return useSurfaceBackgroundOpacity() === 1 ? 'overlay' : 'segments';
}
