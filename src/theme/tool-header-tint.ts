import { contrastRatio } from './contrast';

/** A decorative tint is safe only over a known, opaque background. */
export function canUseToolHeaderTint(
  background: string,
  primary: string,
  inks: readonly string[],
  hasWallpaper: boolean
): boolean {
  if (hasWallpaper || ![background, primary, ...inks].every((c) => /^#[\da-f]{6}$/i.test(c)))
    return false;
  const blended =
    '#' +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          Number.parseInt(background.slice(offset, offset + 2), 16) * 0.92 +
            Number.parseInt(primary.slice(offset, offset + 2), 16) * 0.08
        )
          .toString(16)
          .padStart(2, '0')
      )
      .join('');
  return inks.every((ink) => contrastRatio(ink, blended) >= 4.5);
}
