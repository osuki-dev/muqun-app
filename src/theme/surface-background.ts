/** Background-only color arithmetic. Never apply this to text, icons or artwork. */
export function surfaceBackgroundOpacity(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

/** Combine an authored color alpha with the user's alpha exactly once. */
export function surfaceBackgroundFill(color: string, opacity: number): string {
  const alpha = surfaceBackgroundOpacity(opacity);
  if (alpha === 1 || color === 'transparent') return color;
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(color);
  if (hex) {
    const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
    const authored = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
    return `rgba(${rgb.join(', ')}, ${authored * alpha})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    color
  );
  if (!rgb) return color;
  const channels = rgb.slice(1, 4).map(Number);
  const authored = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (
    channels.some((value) => !Number.isFinite(value) || value < 0 || value > 255) ||
    authored < 0 ||
    authored > 1
  )
    return color;
  return `rgba(${channels.join(', ')}, ${authored * alpha})`;
}

/**
 * The thinnest the sheet's frost over the wallpaper is allowed to get.
 *
 * A sheet is a reading surface laid over live content, and the picture is
 * decoration on it -- so at most the picture gets the remaining 18%, which is
 * enough for it to read as texture and not enough for it to read as a
 * photograph behind text. Fill rather than blur, so both platforms land in the
 * same place: `GlassChrome`'s own Android fallback is a fill for the same
 * reason.
 *
 * This is the floor the reader's slider cannot go under, not the frost's value:
 * the frost itself follows the slider (`sheetFrostAlpha` below), so the
 * default 1 is an opaque sheet and only a reader who thins their surfaces sees
 * the picture.
 */
export const SHEET_FROST_ALPHA = 0.82;

/** The veil over the wallpaper: the reader's opacity, never thinner than the legibility floor. */
export function sheetFrostAlpha(backgroundOpacity: number): number {
  return Math.max(surfaceBackgroundOpacity(backgroundOpacity), SHEET_FROST_ALPHA);
}
