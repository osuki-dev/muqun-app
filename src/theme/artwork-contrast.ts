import type { ThemeManifest } from './schema';

type Colors = ThemeManifest['variants']['light']['colors'];
type Ink = { color: string; minimum: number };

function channels(hex: string): number[] | null {
  return /^#[\da-f]{6}$/i.test(hex)
    ? [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    : null;
}

function luminance(rgb: number[]): number {
  const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

/**
 * Bound arbitrary sRGB artwork over an opaque base. The possible background
 * luminances form a continuous interval between black and white composites.
 * The worst contrast is at the closest point to the ink, including an interior
 * point (ratio 1), not necessarily at either endpoint. Intervals are nested as
 * opacity increases, making binary search safe. This is not a glass/blur bound.
 */
export function safeArtworkOpacity(base: string, inks: readonly Ink[], requested = 1): number {
  if (!Number.isFinite(requested) || requested <= 0 || inks.length === 0) return 0;
  const background = channels(base);
  const foregrounds = inks.map(({ color, minimum }) => ({ rgb: channels(color), minimum }));
  if (
    !background ||
    foregrounds.some(({ rgb, minimum }) => !rgb || !Number.isFinite(minimum) || minimum < 1)
  )
    return 0;
  const values = foregrounds.map(({ rgb, minimum }) => ({ value: luminance(rgb!), minimum }));
  const safe = (opacity: number) => {
    const low = luminance(background.map((c) => c * (1 - opacity)));
    const high = luminance(background.map((c) => c * (1 - opacity) + opacity));
    return values.every(({ value, minimum }) => {
      const closest = Math.max(low, Math.min(high, value));
      return (Math.max(value, closest) + 0.05) / (Math.min(value, closest) + 0.05) >= minimum;
    });
  };
  if (!safe(0)) return 0;
  let low = 0;
  let high = Math.min(1, requested);
  if (safe(high)) return high;
  for (let iteration = 0; iteration < 48; iteration++) {
    const middle = (low + high) / 2;
    if (safe(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** Preserve every normal label and semantic icon drawn by shared chrome. */
export function resolveArtworkOpacity(colors: Colors, requested = 1): number {
  return safeArtworkOpacity(
    colors.surfaceRaised,
    [
      ...(['text', 'textMuted', 'textSubtle'] as const).map((key) => ({
        color: colors[key],
        minimum: 4.5,
      })),
      ...(['primary', 'danger', 'info', 'success', 'warning'] as const).map((key) => ({
        color: colors[key],
        minimum: 3,
      })),
    ],
    requested
  );
}
