// Light mode's surface hierarchy, written down as an executable record.
//
// The method is the one card #654 established for the theme pack registry: a
// ratio is not a wish, it is a measurement, and a measurement that matters gets
// pinned with the number next to it. Change a colour in `../theme` and this file
// names the pair that moved and by how much, rather than letting a palette drift
// a percent at a time until a step disappears -- which is exactly what had
// happened to `surfaceRaised` before this.
//
// Two things are asserted, and they are different in kind:
//
//   - THE LADDER. Light's surfaces have to descend, card to canvas to raised to
//     border to borderStrong, with each rung far enough from the last to be
//     seen. This is the part that broke: `#FBF7F1` sat between canvas and card
//     at 1.07:1 off white, so a "raised" fill on a card was not a step, it was a
//     rounding error, and everything drawn with it lost its footing at once.
//   - THE BAR. Body ink clears 4.5:1 on every ground it is printed on. This is
//     the constraint that had pinned the ladder in place: with the old
//     `textMuted`, any fill darker than the canvas dropped muted text under the
//     bar, so the ladder could not be fixed without moving the ink first.
//
// Dark is asserted too, and asserted to be *unchanged*: this was a light-mode
// pass, and the cheapest way for it to have gone wrong is to have quietly cost
// dark something on the way past.
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

describe('the light palette is the palette this pass produced', () => {
  // Byte-for-byte, so that a value cannot move without someone deciding to move
  // it. The ratios each one was chosen for are asserted further down; this is
  // just the identity of the thing.
  test('surfaces and neutrals', () => {
    expect({
      surface: light.surface,
      background: light.background,
      surfaceRaised: light.surfaceRaised,
      border: light.border,
      borderStrong: light.borderStrong,
    }).toEqual({
      surface: '#FFFFFF',
      background: '#F7F3EC',
      surfaceRaised: '#ECE7DF',
      border: '#E0DAD1',
      borderStrong: '#C2B9AE',
    });
  });

  test('ink tiers', () => {
    expect({
      text: light.text,
      textMuted: light.textMuted,
      textSubtle: light.textSubtle,
      textDisabled: light.textDisabled,
    }).toEqual({
      text: '#050B12',
      textMuted: '#5D6679',
      textSubtle: '#6A7281',
      textDisabled: '#A7ADB8',
    });
  });

  test('the accent row is untouched by a surface pass', () => {
    expect({ primary: light.primary, onPrimary: light.onPrimary, info: light.info }).toEqual({
      primary: '#FF5A4A',
      onPrimary: '#050B12',
      info: '#3E63FF',
    });
  });
});

describe('the ladder', () => {
  const RUNGS = ['surface', 'background', 'surfaceRaised', 'border', 'borderStrong'] as const;

  test('every rung is darker than the one above it', () => {
    const measured = RUNGS.map((rung) => relativeLuminance(light[rung]));
    // Compared against a sorted copy so a failure prints which rung is out of
    // order, not just that the array was not descending.
    expect(measured).toEqual([...measured].sort((a, b) => b - a));
  });

  /**
   * The steps, with the number each was chosen for.
   *
   * `surface:surfaceRaised` is the headline. A selected tab pill is
   * `surface` drawn inside a `surfaceRaised` trough and nothing else -- the
   * library's `Tabs` reads `theme.colors` directly and ignores the `Tabs` entry
   * in `components`, so this ratio *is* the selected state. At the old 1.07 the
   * pill was invisible and the only thing distinguishing a selected tab was its
   * label's ink.
   */
  const STEPS: Record<string, number> = {
    'surface:surfaceRaised': 1.23,
    'background:surfaceRaised': 1.11,
    'surface:background': 1.11,
    'border:surface': 1.39,
    'border:surfaceRaised': 1.13,
    'border:background': 1.26,
    'borderStrong:surface': 1.94,
    'borderStrong:background': 1.75,
  };

  for (const [key, expected] of Object.entries(STEPS)) {
    const [a, b] = key.split(':');
    test(`${key} measures ${expected}`, () => {
      expect(contrast(light[a], light[b])).toBeCloseTo(expected, 2);
    });
  }

  // A fill on a card has to be seen as a fill. 1.15 is the floor a step of this
  // kind is worth drawing at; below it the shape is carried entirely by whatever
  // is inside it, which is how the tab pill, the switch track and the drawer's
  // unselected rows all went flat together.
  test('a raised fill is a visible step on both grounds it is used on', () => {
    expect(contrast(light.surface, light.surfaceRaised)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(light.background, light.surfaceRaised)).toBeGreaterThan(1.1);
  });

  // A border lighter than the fill it outlines is not a border, it is a halo.
  // This is the pairing that constrained how far the raised fill could move.
  test('a border is never lighter than the fill it outlines', () => {
    expect(relativeLuminance(light.border)).toBeLessThan(relativeLuminance(light.surfaceRaised));
  });
});

describe('the bar', () => {
  const BAR = 4.5;

  /**
   * Body ink on every ground it is actually printed on.
   *
   * `textMuted` on `surfaceRaised` is the one that decided the palette: it is
   * the icon in a server-card avatar, the label in a terminal history pill, the
   * body of a code block. Its break-even ground is luminance 0.900 and the
   * canvas is 0.899, so with the old `#667085` there was no room to darken the
   * raised fill at all. The ink moved first, and the ladder followed.
   */
  const BODY: Record<string, number> = {
    'text:background': 17.86,
    'text:surface': 19.75,
    'text:surfaceRaised': 16.05,
    'textMuted:background': 5.21,
    'textMuted:surface': 5.77,
    'textMuted:surfaceRaised': 4.68,
    'onPrimary:primary': 6.41,
  };

  for (const [key, expected] of Object.entries(BODY)) {
    const [ink, ground] = key.split(':');
    test(`${key} measures ${expected} and clears the bar`, () => {
      const ratio = contrast(light[ink], light[ground]);
      expect(ratio).toBeCloseTo(expected, 1);
      expect({ key, clears: ratio >= BAR }).toEqual({ key, clears: true });
    });
  }

  /**
   * The tiers below body, recorded rather than required.
   *
   * `textSubtle` is captions -- a server's address, a control's explanatory line
   * -- and `textDisabled` is a control that cannot be operated, which the bar
   * exempts outright. Neither is held to 4.5:1; both are written down so that a
   * later pass can see where they sit instead of rediscovering it.
   *
   * `textSubtle:surfaceRaised` at 3.93 is deliberate and is the number the value
   * was picked for: it is where the old subtle ink sat on the old raised fill
   * (3.94), so the caption tier keeps its weight relative to the surface it is
   * printed on rather than quietly getting lighter as the surface got darker.
   */
  const RECORDED_BELOW_BAR: Record<string, number> = {
    'textSubtle:background': 4.38,
    'textSubtle:surface': 4.84,
    'textSubtle:surfaceRaised': 3.93,
    'textDisabled:surface': 2.25,
    'textDisabled:surfaceRaised': 1.83,
  };

  for (const [key, expected] of Object.entries(RECORDED_BELOW_BAR)) {
    const [ink, ground] = key.split(':');
    test(`${key} is on the record at ${expected}`, () => {
      expect(contrast(light[ink], light[ground])).toBeCloseTo(expected, 1);
    });
  }

  // The miss this pass retired. `textMuted` on the cream canvas measured 4.4977
  // for as long as the palette had existed -- close enough to round to the bar
  // and still miss it -- and was carried as a recorded exception in
  // `theme-packs.test.ts`. Darkening the ink to unblock the ladder cleared it as
  // a side effect. Asserted here so that re-recording it would take a decision.
  test('muted ink on the canvas no longer misses the bar', () => {
    expect(contrast(light.textMuted, light.background)).toBeGreaterThanOrEqual(BAR);
  });

  test('the ink tiers stay four distinct, ordered steps', () => {
    const tiers = ['text', 'textMuted', 'textSubtle', 'textDisabled'].map((t) => light[t]);
    expect(new Set(tiers).size).toBe(4);
    const measured = tiers.map(relativeLuminance);
    expect(measured).toEqual([...measured].sort((a, b) => a - b));
  });
});

describe('light wears the canvas hue, not the library one', () => {
  // The glass fallback, the switch track and the hairlines were all cool
  // blue-grey (~H220-228) on a warm cream canvas (~H38), which does not read as
  // a quieter background -- it reads as a different material laid on the page.
  test.each(['surfaceRaised', 'border', 'borderStrong'])('%s is in the canvas family', (token) => {
    expect(Math.abs(hue(light[token]) - hue(light.background))).toBeLessThan(12);
  });
});

describe('dark is exactly where the light pass found it', () => {
  test('every dark surface and ink is untouched', () => {
    expect({
      background: dark.background,
      surface: dark.surface,
      surfaceRaised: dark.surfaceRaised,
      border: dark.border,
      borderStrong: dark.borderStrong,
      text: dark.text,
      textMuted: dark.textMuted,
      textSubtle: dark.textSubtle,
      textDisabled: dark.textDisabled,
    }).toEqual({
      background: '#050B12',
      surface: '#0B111A',
      surfaceRaised: '#131B26',
      border: '#1C2532',
      borderStrong: '#2E3A4A',
      text: '#FCFBFA',
      textMuted: '#B6BDC8',
      textSubtle: '#8B95A5',
      textDisabled: '#6B7585',
    });
  });

  test('dark keeps the ladder it already had, in its own direction', () => {
    // Dark runs the other way -- surfaces rise off the canvas -- so the same
    // assertion is the same list reversed.
    const rungs = ['background', 'surface', 'surfaceRaised', 'border', 'borderStrong'].map((r) =>
      relativeLuminance(dark[r])
    );
    expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
  });

  test('dark body ink clears the bar on every surface', () => {
    for (const ground of ['background', 'surface', 'surfaceRaised'] as const) {
      expect({ ground, clears: contrast(dark.text, dark[ground]) >= 4.5 }).toEqual({
        ground,
        clears: true,
      });
    }
  });
});
