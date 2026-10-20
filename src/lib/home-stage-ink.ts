import { contrastRatio } from '@/theme/contrast';

function hex6(color: string): string | null {
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value))
    return `#${[...value.slice(1)].map((channel) => channel + channel).join('')}`.toLowerCase();
  return null;
}

function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
  return `#${[1, 3, 5]
    .map((start) =>
      Math.round(channel(from, start) + (channel(to, start) - channel(from, start)) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * `ink` moved just far enough towards black (on a light ground) or white (on
 * a dark one) to read at `ratio` against `ground` -- the Stage's face lines in
 * the theme's primary, kept legible on the glass whatever the palette. Colours
 * that are not opaque hex are returned unchanged.
 */
export function stageReadableInk(ink: string, ground: string, ratio = 4.5): string {
  const foreground = hex6(ink);
  const background = hex6(ground);
  if (!foreground || !background) return ink;
  if (contrastRatio(foreground, background) >= ratio) return foreground;
  const target =
    contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
      ? '#000000'
      : '#ffffff';
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(foreground, target, step / 20);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return target;
}
