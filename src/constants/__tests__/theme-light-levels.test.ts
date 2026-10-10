// Light mode's surface hierarchy and ink bar, as executable rules.
//
//   - THE LADDER. Light's surfaces descend, card to canvas to raised to border
//     to borderStrong, with each rung far enough from the last to be seen. This
//     is the part that broke: `#FBF7F1` sat between canvas and card at 1.07:1
//     off white, so a "raised" fill on a card was not a step, it was a rounding
//     error.
//   - THE BAR. Body ink clears 4.5:1 on every ground it is printed on. This is
//     the constraint that had pinned the ladder in place.
//
// Dark keeps its own ladder, in the other direction, and its own bar.
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

/**
 * Hue in degrees. Used only to assert that light's neutrals are the canvas's own
 * warm family rather than the library's blue-grey, which is a thing you can see
 * in a screenshot and could not otherwise state in a test.
 */
function hue(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sextant =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sextant * 60 + 360) % 360;
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

describe('the ladder', () => {
  test('every light rung is darker than the one above it, and dark rises the other way', () => {
    const lightRungs = ['surface', 'background', 'surfaceRaised', 'border', 'borderStrong'].map(
      (rung) => relativeLuminance(light[rung])
    );
    expect(lightRungs).toEqual([...lightRungs].sort((a, b) => b - a));
    const darkRungs = ['background', 'surface', 'surfaceRaised', 'border', 'borderStrong'].map(
      (rung) => relativeLuminance(dark[rung])
    );
    expect(darkRungs).toEqual([...darkRungs].sort((a, b) => a - b));
  });

  // A fill on a card has to be seen as a fill. 1.15 is the floor a step of this
  // kind is worth drawing at; below it the tab pill, the switch track and the
  // drawer's unselected rows all went flat together.
  test('a raised fill is a visible step on both grounds it is used on', () => {
    expect(contrast(light.surface, light.surfaceRaised)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(light.background, light.surfaceRaised)).toBeGreaterThan(1.1);
  });

  // A border lighter than the fill it outlines is not a border, it is a halo.
  test('a border is never lighter than the fill it outlines', () => {
    expect(relativeLuminance(light.border)).toBeLessThan(relativeLuminance(light.surfaceRaised));
  });

  // Cool blue-grey neutrals on a warm cream canvas read as a different
  // material laid on the page, not as a quieter background.
  test('light neutrals wear the canvas hue, not the library one', () => {
    const off = ['surfaceRaised', 'border', 'borderStrong'].filter(
      (token) => Math.abs(hue(light[token]) - hue(light.background)) >= 12
    );
    expect(off).toEqual([]);
  });
});

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

  test('the ink tiers stay four distinct, ordered steps', () => {
    const tiers = ['text', 'textMuted', 'textSubtle', 'textDisabled'].map((t) => light[t]);
    expect(new Set(tiers).size).toBe(4);
    const measured = tiers.map(relativeLuminance);
    expect(measured).toEqual([...measured].sort((a, b) => a - b));
  });
});
