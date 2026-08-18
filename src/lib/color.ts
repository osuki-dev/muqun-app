/**
 * Colour arithmetic the theme does not do for us.
 *
 * The design system hands out solid tokens; a gradient edge or a glass tint
 * needs the same colour at a fraction of itself. Keeping the conversion here
 * means one parser rather than one per component -- and one place to teach it a
 * new notation the day a token stops being a six-digit hex.
 */

/**
 * The colour at `alpha`, given a `#rrggbb` token.
 *
 * Anything else -- an `rgba()` string, a named colour, a platform colour -- is
 * returned untouched rather than mangled: a caller that passes one already has
 * the opacity it asked for, and a half-parsed colour is worse than no change.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
