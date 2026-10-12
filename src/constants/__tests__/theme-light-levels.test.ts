import { describe, expect, test } from 'bun:test';

import { darkColors, lightColors } from '../theme-colors';

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const linear = channels(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio. Both arguments must be opaque hex. */
function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const light = lightColors as Record<string, string>;
const dark = darkColors as Record<string, string>;
const BAR = 4.5;

/** The pairs of `palette` that miss `bar`, named, so a failure says which. */
function below(palette: Record<string, string>, pairs: string[], bar: number): string[] {
  return pairs.filter((pair) => {
    const [ink, ground] = pair.split(':');
    return contrast(palette[ink], palette[ground]) < bar;
  });
}

describe('the bar', () => {
  test('body and muted ink clear 4.5:1 on every ground they are printed on', () => {
    // `textMuted` on `surfaceRaised` is the one that decided the palette: the
    // icon in a server-card avatar, the label in a history pill, the body of a
    // code block. Muted on the canvas used to miss the bar at 4.4977.
    expect(
      below(
        light,
        [
          'text:background',
          'text:surface',
          'text:surfaceRaised',
          'textMuted:background',
          'textMuted:surface',
          'textMuted:surfaceRaised',
          'onPrimary:primary',
        ],
        BAR
      )
    ).toEqual([]);
    expect(below(dark, ['text:background', 'text:surface', 'text:surfaceRaised'], BAR)).toEqual([]);
  });
});
