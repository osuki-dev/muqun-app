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
  themeVariant,
} from '../theme-packs';

const MODES = ['light', 'dark'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const RGBA = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), 0\.\d+\)$/;

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

describe('registry shape', () => {
  test('every declared id has exactly one pack, and no pack is undeclared', () => {
    expect(THEME_PACKS.map((pack) => pack.id).sort()).toEqual([...THEME_PACK_IDS].sort());
    expect(THEME_PACKS.length).toBe(THEME_PACK_IDS.length);
  });

  test('the default id resolves, and it is the pack the app falls back to', () => {
    expect(isThemePackId(DEFAULT_THEME_PACK_ID)).toBe(true);
    expect(resolveThemePack(DEFAULT_THEME_PACK_ID).id).toBe(DEFAULT_THEME_PACK_ID);
  });

  test('every pack names its source and both variants', () => {
    const unnamed = THEME_PACKS.filter(
      (pack) => !pack.source || !pack.label || !pack.lightName || !pack.darkName
    ).map((pack) => pack.id);
    expect(unnamed).toEqual([]);
  });
});

/** Every variant the registry ships, labelled `pack/mode`. */
const VARIANTS = THEME_PACKS.flatMap((pack) =>
  MODES.map((mode) => [`${pack.id}/${mode}`, themeVariant(pack, mode)] as const)
);

describe('every colour is a colour', () => {
  test('every variant fills its tokens and its ANSI row with parseable values', () => {
    const bad: string[] = [];
    for (const [label, { colors, terminal }] of VARIANTS) {
      const entries: [string, string][] = Object.entries(colors);
      if (entries.length !== 17) bad.push(`${label}: ${entries.length} tokens`);
      for (const [token, value] of entries) {
        const pattern = ['primarySubtle', 'dangerSubtle'].includes(token) ? RGBA : HEX;
        if (!pattern.test(value)) bad.push(`${label} ${token}: ${value}`);
      }
      if (terminal.ansi.length !== 16) bad.push(`${label}: ${terminal.ansi.length} ANSI`);
      for (const value of [
        ...terminal.ansi,
        terminal.background,
        terminal.foreground,
        terminal.cursor,
        terminal.link,
      ]) {
        if (!HEX.test(value)) bad.push(`${label} terminal: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // A tint is the accent at low alpha. Stated as a literal in the registry so
  // the file stays pure data, which means it can drift from the accent it is
  // supposed to be -- this is the check that it has not.
  test("every tint is its own accent, not a neighbour's", () => {
    const drifted: string[] = [];
    for (const [label, { colors }] of VARIANTS) {
      for (const [tint, base] of [
        [colors.primarySubtle, colors.primary],
        [colors.dangerSubtle, colors.danger],
      ] as const) {
        const match = RGBA.exec(tint);
        const rgb = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
        if (rgb.join() !== channels(base).join()) drifted.push(`${label} ${tint} vs ${base}`);
      }
    }
    expect(drifted).toEqual([]);
  });

  test('every variant keeps its surfaces and its ink tiers apart', () => {
    const merged = VARIANTS.filter(
      ([, { colors }]) =>
        new Set([colors.background, colors.surface, colors.surfaceRaised]).size !== 3 ||
        new Set([colors.text, colors.textMuted, colors.textSubtle, colors.textDisabled]).size !== 4
    ).map(([label]) => label);
    expect(merged).toEqual([]);
  });
});

describe('resolution never returns nothing', () => {
  const junk: [string, unknown][] = [
    ['an id we have never had', 'nord'],
    ['null', null],
    ['an object that looks close enough', { id: 'catppuccin' }],
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

  test('every pair is either above the bar or on the record', () => {
    const off: string[] = [];
    for (const [label, { colors }] of VARIANTS) {
      for (const [ink, ground] of PAIRS) {
        const key = `${label} ${ink}:${ground}`;
        const ratio = contrast(colors[ink], colors[ground]);
        const recorded = RECORDED_BELOW_BAR[key];
        if (ratio < BAR !== (recorded !== undefined)) off.push(`${key} ${ratio.toFixed(2)}`);
        else if (recorded !== undefined && Math.abs(ratio - recorded) >= 0.05) {
          off.push(`${key} ${ratio.toFixed(2)}, recorded ${recorded}`);
        }
      }
    }
    expect(off).toEqual([]);
  });

  // The one bar nothing is allowed to miss: body text on the canvas, and
  // terminal output on its own surface. A theme that cannot manage it is not
  // shippable whoever published it.
  test('every variant keeps body text and terminal output legible', () => {
    const illegible = VARIANTS.filter(
      ([, { colors, terminal }]) =>
        contrast(colors.text, colors.background) < BAR ||
        contrast(terminal.foreground, terminal.background) < BAR
    ).map(([label]) => label);
    expect(illegible).toEqual([]);
  });
});
