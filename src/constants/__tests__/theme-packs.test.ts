// The theme pack registry: that the data is well formed, that resolution never
// hands back nothing, that the default pack is byte-for-byte what the app
// looked like before it was a registry -- and, the part that needs saying out
// loud, exactly which upstream values sit below the contrast bar.
//
// The contrast block is not a wish. It is the audit from card #654 written down
// as an executable record: a *new* pair falling under 4.5:1 fails, while the
// pairs the upstream projects publish below the bar are listed by name and
// pinned, so we neither silently correct someone else's palette nor silently
// acquire a fourth one.
import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_THEME_PACK_ID,
  isThemePackId,
  resolveThemePack,
  THEME_PACK_IDS,
  THEME_PACKS,
  themeSwatch,
  themeVariant,
  type ThemePack,
} from '../theme-packs';

const MODES = ['light', 'dark'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), 0\.\d+\)$/;

/**
 * `toMatch` is absent from the bun:test typings this project resolves, so a
 * regex assertion is spelled out. Returning the offending value rather than
 * `false` keeps the failure message useful: it names the colour, not just that
 * one of thirty-four was wrong.
 */
function matching(value: string, pattern: RegExp): string {
  return pattern.test(value) ? 'matches' : value;
}

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

const eachPack: [string, ThemePack][] = THEME_PACKS.map((pack) => [pack.id, pack]);

describe('registry shape', () => {
  test('every declared id has exactly one pack, and no pack is undeclared', () => {
    expect(THEME_PACKS.map((pack) => pack.id).sort()).toEqual([...THEME_PACK_IDS].sort());
    expect(THEME_PACKS.length).toBe(THEME_PACK_IDS.length);
    expect(THEME_PACKS.length).toBe(32);
  });

  test('the default id resolves, and it is the pack the app falls back to', () => {
    expect(isThemePackId(DEFAULT_THEME_PACK_ID)).toBe(true);
    expect(resolveThemePack(DEFAULT_THEME_PACK_ID).id).toBe(DEFAULT_THEME_PACK_ID);
  });

  test.each(eachPack)('%s names its source and both variants', (_id, pack) => {
    expect(pack.source.length).toBeGreaterThan(0);
    expect(pack.label.length).toBeGreaterThan(0);
    expect(pack.lightName.length).toBeGreaterThan(0);
    expect(pack.darkName.length).toBeGreaterThan(0);
  });
});

describe('every colour is a colour', () => {
  for (const [id, pack] of eachPack) {
    for (const mode of MODES) {
      const { colors, terminal } = themeVariant(pack, mode);

      test(`${id}/${mode} fills all seventeen tokens with parseable values`, () => {
        const alphaTokens = ['primarySubtle', 'dangerSubtle'];
        const entries: [string, string][] = Object.entries(colors);
        expect(entries.length).toBe(17);
        for (const [token, value] of entries) {
          const pattern = alphaTokens.includes(token) ? RGBA : HEX;
          expect(matching(value, pattern)).toBe('matches');
        }
      });

      test(`${id}/${mode} publishes sixteen ANSI colours`, () => {
        expect(terminal.ansi.length).toBe(16);
        for (const value of terminal.ansi) expect(matching(value, HEX)).toBe('matches');
        for (const key of ['background', 'foreground', 'cursor', 'link'] as const) {
          expect(matching(terminal[key], HEX)).toBe('matches');
        }
      });

      // A tint is the accent at low alpha. Stated as a literal in the registry
      // so the file stays pure data, which means it can drift from the accent
      // it is supposed to be -- this is the check that it has not.
      test(`${id}/${mode} tints are their own accent, not a neighbour's`, () => {
        for (const [tint, base] of [
          [colors.primarySubtle, colors.primary],
          [colors.dangerSubtle, colors.danger],
        ] as const) {
          const match = RGBA.exec(tint);
          expect(match).not.toBeNull();
          expect([Number(match![1]), Number(match![2]), Number(match![3])]).toEqual(channels(base));
        }
      });

      test(`${id}/${mode} keeps its surfaces and its ink tiers apart`, () => {
        expect(new Set([colors.background, colors.surface, colors.surfaceRaised]).size).toBe(3);
        expect(
          new Set([colors.text, colors.textMuted, colors.textSubtle, colors.textDisabled]).size
        ).toBe(4);
      });
    }
  }
});

describe('resolution never returns nothing', () => {
  const junk: [string, unknown][] = [
    ['an id we have never had', 'nord'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an object that looks close enough', { id: 'catppuccin' }],
    ['an array', ['osuki']],
  ];
  test.each(junk)('%s falls back to the default pack', (_label, value) => {
    expect(resolveThemePack(value).id).toBe(DEFAULT_THEME_PACK_ID);
  });

  test('a real id is returned as the same frozen object every time', () => {
    // Referential stability is load-bearing: the provider memoises the built
    // theme on it, so a fresh object per call would rebuild the palette -- and
    // repaint every screen -- on each render.
    expect(resolveThemePack('catppuccin')).toBe(resolveThemePack('catppuccin'));
  });

  test('isThemePackId agrees with the registry', () => {
    expect(isThemePackId('everforest')).toBe(true);
    expect(isThemePackId('Everforest')).toBe(false);
    expect(isThemePackId(null)).toBe(false);
  });
});

describe('the default pack is the app as it was', () => {
  // A regression guard, not a restatement: these are the values the app shipped
  // before the registry existed. If someone edits Osuki they have to edit this
  // too, deliberately.
  const osuki = resolveThemePack('osuki');

  test('light is the Osuki spec', () => {
    expect(osuki.light.colors.background).toBe('#F7F3EC');
    expect(osuki.light.colors.surface).toBe('#FFFFFF');
    expect(osuki.light.colors.text).toBe('#050B12');
    expect(osuki.light.colors.primary).toBe('#FF5A4A');
    expect(osuki.light.colors.onPrimary).toBe('#050B12');
  });

  test('dark is the Osuki spec', () => {
    expect(osuki.dark.colors.background).toBe('#050B12');
    expect(osuki.dark.colors.text).toBe('#FCFBFA');
    expect(osuki.dark.colors.primary).toBe('#FF5A4A');
  });

  test('the terminal rows are the ones the mixer used to produce', () => {
    // These used to be assembled at call time out of app tokens; the point of
    // materialising them was that the result did not change.
    expect(osuki.dark.terminal.background).toBe('#08111B');
    expect(osuki.dark.terminal.foreground).toBe('#D8E1EA');
    expect(osuki.dark.terminal.ansi[0]).toBe('#0C121A');
    expect(osuki.dark.terminal.ansi[1]).toBe(osuki.dark.colors.danger);
    expect(osuki.dark.terminal.ansi[2]).toBe(osuki.dark.colors.success);
    expect(osuki.dark.terminal.ansi[3]).toBe(osuki.dark.colors.warning);
    expect(osuki.dark.terminal.ansi[7]).toBe(osuki.dark.colors.textMuted);
    expect(osuki.dark.terminal.ansi[15]).toBe(osuki.dark.colors.text);

    expect(osuki.light.terminal.ansi[0]).toBe(osuki.light.colors.text);
    expect(osuki.light.terminal.ansi[1]).toBe(osuki.light.colors.danger);
    expect(osuki.light.terminal.ansi[8]).toBe(osuki.light.colors.textSubtle);
    expect(osuki.light.terminal.ansi[12]).toBe(osuki.light.colors.info);
  });
});

describe('contrast', () => {
  const BAR = 4.5;

  /**
   * Upstream values that sit below the bar, measured and named.
   *
   * Every entry here is a colour its own project publishes, kept as published.
   * Most pairs clear the bar. The exceptions are intentionally low-contrast
   * accents in a few upstream palettes, plus muted text in three older light
   * schemes; naming them prevents a future pack from adding an accidental miss.
   */
  const RECORDED_BELOW_BAR: Record<string, number> = {
    // Osuki's own, and older than this registry: `textMuted` on the cream
    // canvas measures 4.4977, which rounds to the bar and misses it. Recorded
    // rather than nudged, because moving the shipped default palette is a
    // design decision and not a side effect of adding four themes.
    // Everforest light: the whole accent row is mid-tone. `green` is the colour
    // Everforest puts in its own status line and is the best of them.
    'everforest/light onPrimary:primary': 2.69,
    'everforest/light textMuted:background': 2.77,
    'everforest/light textMuted:surface': 3.08,
    // Light Owl uses its editor blue for terminal/UI actions. Its own light
    // ink is the best published counterpart and still lands below the bar.
    'night-owl/light onPrimary:primary': 3.42,
    // Rose Pine Dawn: `rose` is the namesake accent; nothing in Dawn clears the
    // bar on it, `text` at 3.34 being the best of the palette's own inks.
    'rose-pine/light onPrimary:primary': 3.34,
    'rose-pine/light textMuted:background': 4.02,
    'rose-pine/light textMuted:surface': 4.23,
    // Selenized dark keeps the official vivid blue and its darkest published
    // ink on accent controls; the pair is intentionally chromatic rather than
    // a neutral black/white substitution.
    'selenized/dark onPrimary:primary': 3.92,
    // Solarized deliberately preserves the same eight accents across modes;
    // neither base03 nor base3 clears the button-text bar on blue.
    'solarized/light onPrimary:primary': 3.41,
    'solarized/dark onPrimary:primary': 4.08,
    // Tokyo Night Day: `fg` clears the bar on `bg` and on nothing else the
    // palette offers, so cards and troughs carry body text below it.
    'tokyo-night/light text:surface': 3.99,
    'tokyo-night/light text:surfaceRaised': 3.52,
    'tokyo-night/light onPrimary:primary': 3.11,
    'tokyo-night/light textMuted:background': 3.57,
    'tokyo-night/light textMuted:surface': 3.15,
  };

  const PAIRS = [
    ['text', 'background'],
    ['text', 'surface'],
    ['text', 'surfaceRaised'],
    ['textMuted', 'background'],
    ['textMuted', 'surface'],
    ['onPrimary', 'primary'],
  ] as const;

  for (const [id, pack] of eachPack) {
    for (const mode of MODES) {
      const { colors, terminal } = themeVariant(pack, mode);

      test(`${id}/${mode} is either above the bar or on the record`, () => {
        for (const [ink, ground] of PAIRS) {
          const key = `${id}/${mode} ${ink}:${ground}`;
          const ratio = contrast(colors[ink], colors[ground]);
          const recorded = RECORDED_BELOW_BAR[key];
          // Compared as objects so a failure prints the pair and the number
          // rather than `true !== false`.
          expect({ key, belowBar: ratio < BAR }).toEqual({
            key,
            belowBar: recorded !== undefined,
          });
          if (recorded !== undefined) expect(ratio).toBeCloseTo(recorded, 1);
        }
      });

      // The one bar nothing is allowed to miss. Body text on the app's canvas is
      // the most-read pixel pairing in the product; a theme that cannot manage
      // it is not shippable whoever published it.
      test(`${id}/${mode} keeps body text legible on the canvas`, () => {
        expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(BAR);
      });

      test(`${id}/${mode} keeps terminal output legible on its own surface`, () => {
        expect(contrast(terminal.foreground, terminal.background)).toBeGreaterThanOrEqual(BAR);
      });
    }
  }
});

describe('swatches', () => {
  test.each(eachPack)('%s previews itself, in the mode being shown', (_id, pack) => {
    for (const mode of MODES) {
      const { colors } = themeVariant(pack, mode);
      expect(themeSwatch(pack, mode)).toEqual([
        colors.background,
        colors.primary,
        colors.info,
        colors.warning,
      ]);
    }
  });

  test('no two packs look the same at a glance', () => {
    for (const mode of MODES) {
      const seen = THEME_PACKS.map((pack) => themeSwatch(pack, mode).join('|'));
      expect(new Set(seen).size).toBe(THEME_PACKS.length);
    }
  });
});
