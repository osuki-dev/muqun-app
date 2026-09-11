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
