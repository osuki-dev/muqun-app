import { withAlpha } from '@/lib/color';
import type { TerminalStyle } from '@/terminal/types';

/** Legacy packs and malformed runtime values stay opaque. No contrast-based override. */
export function terminalBackgroundOpacity(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

export function terminalBackgroundFill(theme: { background: string; backgroundOpacity?: number }) {
  return withAlpha(theme.background, terminalBackgroundOpacity(theme.backgroundOpacity));
}

/** An explicitly painted ANSI cell stays opaque, even if its color equals the default. */
export function paintsCellBackground(style: TerminalStyle, resolved: string, fallback: string) {
  return style.background != null || Boolean(style.inverse) || resolved !== fallback;
}

/**
 * The colour an opaque canvas can use in place of a translucent one.
 *
 * A translucent terminal exists to let what is behind it show through. When
 * that is nothing but the app's own flat background, "translucent over flat"
 * and "opaque, pre-blended" are the same pixels -- and the difference in cost
 * is not small: react-native-skia gives an opaque canvas a hardware-composer
 * layer the system can promote to an overlay, and a non-opaque one a texture
 * HWUI re-samples and recomposites on every frame.
 *
 * Only valid when nothing patterned is behind the canvas. With wallpaper there,
 * each pixel blends against a different colour and no single fill can stand in.
 */
export function blendedTerminalFill(background: string, behind: string, opacity: number): string {
  const alpha = terminalBackgroundOpacity(opacity);
  if (alpha === 1) return background;
  const front = channels(background);
  const back = channels(behind);
  if (!front || !back) return withAlpha(background, alpha);
  // The authored colour may carry its own alpha; it composites first, exactly
  // as it would have when the canvas did the blending.
  const effective = alpha * front[3];
  const mixed = [0, 1, 2].map((index) =>
    Math.round(front[index] * effective + back[index] * (1 - effective))
  );
  return `rgb(${mixed.join(', ')})`;
}

/**
 * Which canvas a pane gets, and what it is filled with.
 *
 * `opaque` is decided from the **app** theme and the wallpaper only -- never
 * from the pane's own theme -- so it cannot change while a pane lives unless
 * the reader changes their theme. That is load-bearing: react-native-skia 3.0.1
 * replaces the native view when `opaque` changes (`SkiaBaseView.updateView`:
 * opaque is a `SurfaceView`, translucent a `TextureView`), which is a new
 * surface, a new swap chain and a blank first frame. Keyed on the pane theme,
 * it flipped every time a full-screen program's surface was adopted or released
 * over a wallpaper (adopted surfaces are opacity 1, the app theme is not), and
 * every such flip was a visible flash.
 *
 * It costs nothing in pixels. A pane theme can only be translucent when the app
 * theme is (an adopted surface is opacity 1, or the app's own opacity when the
 * program painted none), so:
 *
 * - no wallpaper: always opaque, and the fill pre-blends the pane's colour over
 *   the flat app background, as before;
 * - wallpaper, opaque app terminal: opaque, and every pane theme it can wear is
 *   opacity 1, so the fill is the colour itself;
 * - wallpaper, translucent app terminal: always translucent. The app theme lets
 *   the wallpaper through exactly as before; an adopted surface fills at its own
 *   opacity of 1, so it stays the solid, legible ground card #685 asked for
 *   rather than a scheme's chips floating on the picture. The only cost is that
 *   such a pane no longer gets the opaque layer while it wears its surface.
 */
export function terminalCanvasPaint(
  appTheme: { backgroundOpacity?: number },
  paneTheme: { background: string; backgroundOpacity?: number },
  behind: string,
  wallpaperBehind: boolean
): { opaque: boolean; fill: string } {
  const opaque = !wallpaperBehind || terminalBackgroundOpacity(appTheme.backgroundOpacity) === 1;
  return {
    opaque,
    fill: opaque
      ? blendedTerminalFill(
          paneTheme.background,
          behind,
          terminalBackgroundOpacity(paneTheme.backgroundOpacity)
        )
      : terminalBackgroundFill(paneTheme),
  };
}

/** `[r, g, b, a]` from `#RRGGBB`, `#RRGGBBAA` or `rgb()`/`rgba()`. */
function channels(color: string): [number, number, number, number] | null {
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((offset) =>
      Number.parseInt(hex[1].slice(offset, offset + 2), 16)
    );
    return [r, g, b, hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    color
  );
  if (!rgb) return null;
  const values = rgb.slice(1, 4).map(Number);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return null;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return [values[0], values[1], values[2], alpha];
}
