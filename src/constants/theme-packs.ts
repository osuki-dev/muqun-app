/**
 * The theme pack registry.
 *
 * A theme pack is the whole of a look: the seventeen UI colour tokens for light
 * and for dark, and the terminal's own surface plus its ANSI 16. Everything here
 * is *data*. Nothing in this file mixes, lightens, or derives a colour at
 * runtime -- picking a theme is a lookup, so the same eight bytes that ship in
 * the bundle are the eight bytes that reach the renderer, and a pack can later
 * come from somewhere other than this file (card #655) without a second code
 * path appearing.
 *
 * The original five packs remain here; the developer palettes live in the two
 * `developer-theme-packs*` modules. Every value comes from the source named on
 * its pack. Upstream values that miss the 4.5:1 body-text bar are recorded in
 * the contrast audit rather than being allowed to slip in unnoticed.
 */

import type { Colors } from '@osuki-dev/ui';

import { DEVELOPER_THEME_PACKS_BY_ID } from '@/constants/developer-theme-packs';
import { DEVELOPER_THEME_PACKS_2026_BY_ID } from '@/constants/developer-theme-packs-2026';

/**
 * The library's own colour contract, restated as the pack's obligation: a pack
 * fills in every token, so there is no half-themed screen and no silent
 * fallback to the library's default palette for the one role a pack forgot.
 * Aliased rather than re-declared, so a rename upstream is a compile error here.
 */
export type ThemeTokens = Colors;

/** ANSI 0-7 then bright 8-15. A tuple, so a pack cannot ship fifteen. */
export type AnsiPalette = readonly [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
];

export type TerminalTokens = {
  background: string;
  foreground: string;
  cursor: string;
  link: string;
  selection: string;
  ansi: AnsiPalette;
};

export type ThemeVariant = {
  colors: ThemeTokens;
  terminal: TerminalTokens;
};

export const THEME_PACK_IDS = [
  'osuki',
  'ayu',
  'bamboo',
  'bluloco',
  'catppuccin',
  'cyberdream',
  'dracula',
  'edge',
  'everforest',
  'flexoki',
  'github',
  'gruvbox',
  'iceberg',
  'kanagawa',
  'kanso',
  'material',
  'melange',
  'monokai-pro',
  'modus',
  'neovim',
  'nightfox',
  'night-owl',
  'oxocarbon',
  'osaka-jade',
  'papercolor',
  'rose-pine',
  'selenized',
  'solarized',
  'tokyo-night',
  'tomorrow',
  'vs-code-2026',
  'zenwritten',
] as const;

export type ThemePackId = (typeof THEME_PACK_IDS)[number];

export type ThemePack = {
  id: ThemePackId;
  /**
   * Untranslated on purpose. These are proper nouns -- "Catppuccin" is
   * "Catppuccin" in every locale -- and the variant names beside them are how
   * their own communities say them.
   */
  label: string;
  /** Where every hex below came from, so the next person can re-check them. */
  source: string;
  /** Which upstream variant each mode is, for the settings caption. */
  lightName: string;
  darkName: string;
  light: ThemeVariant;
  dark: ThemeVariant;
};

/* ------------------------------------------------------------------ osuki -- */

/**
 * Osuki, the default: the Osuki design specification (https://osuki.dev/design.md).
 *
 * Lifted verbatim out of `theme.ts` and `terminal/palette.ts`, including the
 * two terminal ANSI rows that used to be assembled at call time from app
 * tokens. Choosing this pack has to be indistinguishable from the app before
 * the registry existed, so the values are copied, not recomputed.
 */
const osuki: ThemePack = {
  id: 'osuki',
  label: 'Osuki',
  source: 'https://osuki.dev/design.md',
  lightName: 'Light',
  darkName: 'Dark',
  light: {
    colors: {
      // The canvas is the spec's warm cream, which is the one value that pulls
      // the whole scale off the library's cool neutrals: a surface mixed for
      // `#FCFBFA` reads grey-green on `#F7F3EC`. Surfaces run *lighter* than
      // the canvas here -- a card lifts toward white.
      background: '#F7F3EC',
      surface: '#FFFFFF',
      // Between canvas and card. Field fills, chips and tab troughs sit on
      // both, so it has to read as a distinct step against either one.
      surfaceRaised: '#ECE7DF',
      border: '#E0DAD1',
      borderStrong: '#C2B9AE',
      text: '#050B12',
      textMuted: '#5D6679',
      // Not in the spec. Darkened from the library's `#8A93A3`, which cleared
      // only 2.8:1 on the cream canvas.
      textSubtle: '#6A7281',
      textDisabled: '#A7ADB8',
      primary: '#FF5A4A',
      // Dark ink, not white. White on the accent measures 3.1:1; the ink
      // measures 6.3:1 and is the only choice that clears 4.5:1 on a button.
      onPrimary: '#050B12',
      primarySubtle: 'rgba(255, 90, 74, 0.14)',
      danger: '#D93025',
      dangerSubtle: 'rgba(217, 48, 37, 0.12)',
      success: '#1F9D6B',
      warning: '#D98A1F',
      // The spec's `interactive` / `link` / `focus-ring`, which share one value.
      info: '#3E63FF',
    },
    terminal: {
      background: '#F7F3EC',
      foreground: '#050B12',
      cursor: '#FF5A4A',
      link: '#3E63FF',
      selection: 'rgba(255, 90, 74, 0.14)',
      ansi: [
        '#050B12', '#D93025', '#027A48', '#B54708',
        '#3538CD', '#6941C6', '#0E7090', '#475467',
        '#6A7281', '#B42318', '#027A48', '#B54708',
        '#3E63FF', '#7F56D9', '#0E7090', '#050B12',
      ],
    },
  },
  dark: {
    colors: {
      background: '#050B12',
      surface: '#0B111A',
      // One step above the surface, on the line the spec draws from `#050B12`
      // to `#0B111A`.
      surfaceRaised: '#131B26',
      border: '#1C2532',
      borderStrong: '#2E3A4A',
      text: '#FCFBFA',
      textMuted: '#B6BDC8',
      textSubtle: '#8B95A5',
      textDisabled: '#6B7585',
      primary: '#FF5A4A',
      onPrimary: '#050B12',
      primarySubtle: 'rgba(255, 90, 74, 0.24)',
      danger: '#F2554A',
      dangerSubtle: 'rgba(242, 85, 74, 0.16)',
      success: '#34C08B',
      warning: '#F0A93C',
      info: '#6B87FF',
    },
    terminal: {
      // A dark terminal keeps its own surface rather than the app canvas, the
      // way every desktop terminal does.
      background: '#08111B',
      foreground: '#D8E1EA',
      cursor: '#FF5A4A',
      link: '#A4BCFD',
      selection: 'rgba(255, 90, 74, 0.24)',
      ansi: [
        '#0C121A', '#F2554A', '#34C08B', '#F0A93C',
        '#7DA2FF', '#C7A0FF', '#67E3F9', '#B6BDC8',
        '#6B7585', '#FDA29B', '#6CE9A6', '#FEC84B',
        '#A4BCFD', '#D6BBFB', '#A5F0FC', '#FCFBFA',
      ],
    },
  },
};

/* ------------------------------------------------------------ catppuccin -- */

/**
 * Catppuccin -- Latte and Mocha, the two ends of the four-flavour scale.
 *
 * Colours: `catppuccin/palette` `palette.json` v1.8.0, `.latte.colors` and
 * `.mocha.colors`. ANSI: the `ansiColors` block of the same file, which is the
 * mapping every Catppuccin terminal port is generated from.
 *
 * Surface ladder: Catppuccin names `mantle` the secondary background and `base`
 * the main one, so the canvas is `mantle` and a card is `base` -- which is also
 * the only reading that keeps the ladder monotonic in both modes. `surface0/1/2`
 * continue it upward into raised fills and borders. In Latte that puts a field
 * trough *darker* than the canvas, which is what Catppuccin's own light ports do.
 */
const catppuccin: ThemePack = {
  id: 'catppuccin',
  label: 'Catppuccin',
  source: 'https://github.com/catppuccin/palette (palette.json v1.8.0)',
  lightName: 'Latte',
  darkName: 'Mocha',
  light: {
    colors: {
      background: '#e6e9ef', // mantle
      surface: '#eff1f5', // base
      surfaceRaised: '#ccd0da', // surface0
      border: '#bcc0cc', // surface1
      borderStrong: '#acb0be', // surface2
      text: '#4c4f69', // text
      textMuted: '#5c5f77', // subtext1
      textSubtle: '#6c6f85', // subtext0
      textDisabled: '#8c8fa1', // overlay1
      // Mauve is Catppuccin's default accent across its own ports.
      primary: '#8839ef', // mauve
      onPrimary: '#eff1f5', // base -- 4.79:1 on mauve, the only ink that clears 4.5
      primarySubtle: 'rgba(136, 57, 239, 0.14)',
      danger: '#d20f39', // red
      dangerSubtle: 'rgba(210, 15, 57, 0.12)',
      success: '#40a02b', // green
      warning: '#df8e1d', // yellow
      info: '#1e66f5', // blue
    },
    terminal: {
      background: '#eff1f5', // base
      foreground: '#4c4f69', // text
      cursor: '#dc8a78', // rosewater, as the Catppuccin terminal ports use
      link: '#1e66f5', // blue
      selection: '#acb0be', // surface2
      ansi: [
        '#5c5f77', '#d20f39', '#40a02b', '#df8e1d',
        '#1e66f5', '#ea76cb', '#179299', '#acb0be',
        '#6c6f85', '#de293e', '#49af3d', '#eea02d',
        '#456eff', '#fe85d8', '#2d9fa8', '#bcc0cc',
      ],
    },
  },
  dark: {
    colors: {
      background: '#181825', // mantle
      surface: '#1e1e2e', // base
      surfaceRaised: '#313244', // surface0
      border: '#45475a', // surface1
      borderStrong: '#585b70', // surface2
      text: '#cdd6f4', // text
      textMuted: '#bac2de', // subtext1
      textSubtle: '#a6adc8', // subtext0
      textDisabled: '#7f849c', // overlay1
      primary: '#cba6f7', // mauve
      onPrimary: '#11111b', // crust -- 9.23:1 on mauve
      primarySubtle: 'rgba(203, 166, 247, 0.24)',
      danger: '#f38ba8', // red
      dangerSubtle: 'rgba(243, 139, 168, 0.16)',
      success: '#a6e3a1', // green
      warning: '#f9e2af', // yellow
      info: '#89b4fa', // blue
    },
    terminal: {
      background: '#1e1e2e', // base
      foreground: '#cdd6f4', // text
      cursor: '#f5e0dc', // rosewater
      link: '#89b4fa', // blue
      selection: '#585b70', // surface2
      ansi: [
        '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af',
        '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8',
        '#585b70', '#f37799', '#89d88b', '#ebd391',
        '#74a8fc', '#f2aede', '#6bd7ca', '#bac2de',
      ],
    },
  },
};

/* ------------------------------------------------------------- rose-pine -- */

/**
 * Rosé Pine -- Dawn and Main. Main, not Moon: `rose-pine/neovim`'s
 * `palette.lua` falls back to `variants[dark_variant or "main"]`.
 *
 * Colours: `rose-pine/palette` `palette.json`, plus the `highlight_low/med/high`
 * tier from `rose-pine/neovim` `lua/rose-pine/palette.lua`, which the canonical
 * file omits and which is the only official source for a border value.
 * ANSI: `rose-pine/alacritty` `dist/rose-pine.toml` and `dist/rose-pine-dawn.toml`.
 *
 * Two mappings worth naming. Rosé Pine has no green and no plain blue, and its
 * own ANSI table puts `pine` in the green slot and `foam` in the blue slot --
 * so `success` is `pine` and `info` is `foam` here for the same reason, not as
 * an invention. And the palette carries only three foreground tiers, so the
 * fourth (`textDisabled`) borrows `highlight_high`, the lightest of the
 * highlight steps.
 *
 * Recorded discrepancy: `rose-pine/alacritty` still ships Dawn's foreground as
 * `#575279`, while `rose-pine/palette` *and* `rose-pine/neovim` both say
 * `#464261`. Two of three official repos agree, so `#464261` is used and the
 * ANSI 7/15 slots are corrected to match the palette they belong to.
 */
const rosePine: ThemePack = {
  id: 'rose-pine',
  label: 'Rosé Pine',
  source: 'https://github.com/rose-pine/palette + rose-pine/neovim + rose-pine/alacritty',
  lightName: 'Dawn',
  darkName: 'Main',
  light: {
    colors: {
      background: '#faf4ed', // base
      surface: '#fffaf3', // surface
      surfaceRaised: '#f2e9e1', // overlay
      border: '#dfdad9', // highlight_med
      borderStrong: '#cecacd', // highlight_high
      text: '#464261', // text
      textMuted: '#797593', // subtle
      textSubtle: '#9893a5', // muted
      textDisabled: '#cecacd', // highlight_high
      // The namesake. It measures 3.34:1 against its own best ink and is
      // shipped as published -- see card #654.
      primary: '#d7827e', // rose
      onPrimary: '#464261', // text -- the best of the palette's own inks
      primarySubtle: 'rgba(215, 130, 126, 0.14)',
      danger: '#b4637a', // love
      dangerSubtle: 'rgba(180, 99, 122, 0.12)',
      success: '#286983', // pine, which is Rosé Pine's own ANSI green
      warning: '#ea9d34', // gold
      info: '#56949f', // foam, which is Rosé Pine's own ANSI blue
    },
    terminal: {
      background: '#faf4ed', // base
      foreground: '#464261', // text
      cursor: '#cecacd',
      link: '#56949f', // foam
      selection: '#dfdad9',
      ansi: [
        '#f2e9e1', '#b4637a', '#286983', '#ea9d34',
        '#56949f', '#907aa9', '#d7827e', '#464261',
        '#9893a5', '#b4637a', '#286983', '#ea9d34',
        '#56949f', '#907aa9', '#d7827e', '#464261',
      ],
    },
  },
  dark: {
    colors: {
      background: '#191724', // base
      surface: '#1f1d2e', // surface
      surfaceRaised: '#26233a', // overlay
      border: '#403d52', // highlight_med
      borderStrong: '#524f67', // highlight_high
      text: '#e0def4', // text
      textMuted: '#908caa', // subtle
      textSubtle: '#6e6a86', // muted
      textDisabled: '#524f67', // highlight_high
      primary: '#ebbcba', // rose
      onPrimary: '#191724', // base -- 10.45:1
      primarySubtle: 'rgba(235, 188, 186, 0.24)',
      danger: '#eb6f92', // love
      dangerSubtle: 'rgba(235, 111, 146, 0.16)',
      success: '#31748f', // pine
      warning: '#f6c177', // gold
      info: '#9ccfd8', // foam
    },
    terminal: {
      background: '#191724', // base
      foreground: '#e0def4', // text
      cursor: '#524f67',
      link: '#9ccfd8', // foam
      selection: '#403d52',
      ansi: [
        '#26233a', '#eb6f92', '#31748f', '#f6c177',
        '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
        '#6e6a86', '#eb6f92', '#31748f', '#f6c177',
        '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      ],
    },
  },
};

/* ------------------------------------------------------------ everforest -- */

/**
 * Everforest -- light and dark, both at the `medium` contrast step, which
 * `palette.md` names the default of the three.
 *
 * Colours: `sainnhe/everforest` `autoload/everforest.vim`, the `medium` branch
 * of `everforest#get_palette()`. ANSI: `colors/everforest.vim`, the `s:terminal`
 * dict feeding `g:terminal_color_0..15`.
 *
 * Everforest publishes no bright row: `g:terminal_color_8..15` repeat `0..7`
 * verbatim. That is reproduced rather than brightened -- a bright row we
 * invented would be the one part of this pack that is not Everforest.
 *
 * `bg2` is skipped in the ladder because in the light palette it is byte-equal
 * to `bg_dim`; `bg3`/`bg4` carry the two border tiers in both modes so the two
 * sides stay symmetric.
 *
 * `primary` is `green`, the colour Everforest puts in its own status line. It
 * measures 2.69:1 in light against the best ink the palette offers, and no
 * other Everforest light accent clears 4.5:1 either -- the light scheme is
 * mid-tone by design. Shipped as published; recorded on card #654.
 */
const everforest: ThemePack = {
  id: 'everforest',
  label: 'Everforest',
  source: 'https://github.com/sainnhe/everforest (medium)',
  lightName: 'Light',
  darkName: 'Dark',
  light: {
    colors: {
      background: '#efebd4', // bg_dim
      surface: '#fdf6e3', // bg0
      surfaceRaised: '#f4f0d9', // bg1
      border: '#e6e2cc', // bg3
      borderStrong: '#e0dcc7', // bg4
      text: '#5c6a72', // fg
      textMuted: '#829181', // grey2
      textSubtle: '#939f91', // grey1
      textDisabled: '#a6b0a0', // grey0
      primary: '#8da101', // green
      onPrimary: '#fdf6e3', // bg0 -- 2.69:1, the best the palette offers
      primarySubtle: 'rgba(141, 161, 1, 0.14)',
      danger: '#f85552', // red
      dangerSubtle: 'rgba(248, 85, 82, 0.12)',
      // Aqua, not green: `primary` already took green, and two identical
      // tokens is a theme that cannot say "done" and "go" differently.
      success: '#35a77c', // aqua
      warning: '#dfa000', // yellow
      info: '#3a94c5', // blue
    },
    terminal: {
      background: '#fdf6e3', // bg0
      foreground: '#5c6a72', // fg
      cursor: '#5c6a72', // fg
      link: '#3a94c5', // blue
      selection: '#eaedc8', // bg_visual
      ansi: [
        // Everforest swaps slots 0 and 7 by background: in light, `black` is
        // `fg` and `white` is `bg3`.
        '#5c6a72', '#f85552', '#8da101', '#dfa000',
        '#3a94c5', '#df69ba', '#35a77c', '#e6e2cc',
        '#5c6a72', '#f85552', '#8da101', '#dfa000',
        '#3a94c5', '#df69ba', '#35a77c', '#e6e2cc',
      ],
    },
  },
  dark: {
    colors: {
      background: '#232a2e', // bg_dim
      surface: '#2d353b', // bg0
      surfaceRaised: '#343f44', // bg1
      border: '#475258', // bg3
      borderStrong: '#4f585e', // bg4
      text: '#d3c6aa', // fg
      textMuted: '#9da9a0', // grey2
      textSubtle: '#859289', // grey1
      textDisabled: '#7a8478', // grey0
      primary: '#a7c080', // green
      onPrimary: '#232a2e', // bg_dim -- 7.28:1
      primarySubtle: 'rgba(167, 192, 128, 0.24)',
      danger: '#e67e80', // red
      dangerSubtle: 'rgba(230, 126, 128, 0.16)',
      success: '#83c092', // aqua
      warning: '#dbbc7f', // yellow
      info: '#7fbbb3', // blue
    },
    terminal: {
      background: '#2d353b', // bg0
      foreground: '#d3c6aa', // fg
      cursor: '#d3c6aa', // fg
      link: '#7fbbb3', // blue
      selection: '#543a48', // bg_visual
      ansi: [
        '#475258', '#e67e80', '#a7c080', '#dbbc7f',
        '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
        '#475258', '#e67e80', '#a7c080', '#dbbc7f',
        '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
      ],
    },
  },
};

/* ----------------------------------------------------------- tokyo-night -- */

/**
 * Tokyo Night -- Day and Moon. Moon, not Storm: `lua/tokyonight/config.lua`
 * sets `M.defaults.style = "moon"` and `light_style = "day"`. The README prose
 * still says storm; the code is what the plugin actually loads.
 *
 * Colours and ANSI: `folke/tokyonight.nvim` `extras/lua/tokyonight_day.lua` and
 * `tokyonight_moon.lua` -- the generated static dumps, including their
 * `terminal` sub-table. `colors/day.lua` cannot be read instead: Day is
 * computed by inverting Night at load time and contains no literals at all.
 * Cross-checked against `extras/alacritty/tokyonight_{day,moon}.toml`.
 *
 * Surface ladder follows upstream's own semantics rather than a lightness
 * sort: `bg` is the main editor background, so it is the app canvas, and
 * `bg_dark` is what the plugin gives sidebars, floats and popups -- which is
 * what a card is. That pairing also matters for legibility in Day, where `fg`
 * clears 4.5:1 on `bg` and on nothing else the palette offers; putting the
 * canvas anywhere else would have put the app's most-read text below the bar.
 *
 * `primary` is `blue`, the plugin's signature. In Day it measures 3.11:1
 * against its own best ink; shipped as published, recorded on card #654.
 */
const tokyoNight: ThemePack = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  source: 'https://github.com/folke/tokyonight.nvim (extras/lua)',
  lightName: 'Day',
  darkName: 'Moon',
  light: {
    colors: {
      background: '#e1e2e7', // bg
      surface: '#d0d5e3', // bg_dark
      surfaceRaised: '#c4c8da', // bg_highlight
      border: '#a8aecb', // fg_gutter
      borderStrong: '#a1a6c5', // terminal_black
      text: '#3760bf', // fg
      textMuted: '#6172b0', // fg_dark
      textSubtle: '#848cb5', // comment
      textDisabled: '#8990b3', // dark3
      primary: '#2e7de9', // blue
      onPrimary: '#e1e2e7', // bg -- 3.11:1, the best of the palette's inks
      primarySubtle: 'rgba(46, 125, 233, 0.14)',
      danger: '#f52a65', // red
      dangerSubtle: 'rgba(245, 42, 101, 0.12)',
      success: '#587539', // green
      warning: '#8c6c3e', // yellow
      info: '#07879d', // info
    },
    terminal: {
      background: '#e1e2e7', // bg
      foreground: '#3760bf', // fg
      cursor: '#3760bf', // fg
      link: '#2e7de9', // blue
      selection: '#b7c1e3', // bg_visual
      ansi: [
        '#b4b5b9', '#f52a65', '#587539', '#8c6c3e',
        '#2e7de9', '#9854f1', '#007197', '#6172b0',
        '#a1a6c5', '#ff4774', '#5c8524', '#a27629',
        '#358aff', '#a463ff', '#007ea8', '#3760bf',
      ],
    },
  },
  dark: {
    colors: {
      background: '#222436', // bg
      surface: '#1e2030', // bg_dark
      surfaceRaised: '#2f334d', // bg_highlight
      border: '#3b4261', // fg_gutter
      borderStrong: '#444a73', // terminal_black
      text: '#c8d3f5', // fg
      textMuted: '#828bb8', // fg_dark
      textSubtle: '#636da6', // comment
      textDisabled: '#545c7e', // dark3
      primary: '#82aaff', // blue
      onPrimary: '#1e2030', // bg_dark -- 7.01:1
      primarySubtle: 'rgba(130, 170, 255, 0.24)',
      danger: '#ff757f', // red
      dangerSubtle: 'rgba(255, 117, 127, 0.16)',
      success: '#c3e88d', // green
      warning: '#ffc777', // yellow
      info: '#0db9d7', // info
    },
    terminal: {
      background: '#222436', // bg
      foreground: '#c8d3f5', // fg
      cursor: '#c8d3f5', // fg
      link: '#82aaff', // blue
      selection: '#2d3f76', // bg_visual
      ansi: [
        '#1b1d2b', '#ff757f', '#c3e88d', '#ffc777',
        '#82aaff', '#c099ff', '#86e1fc', '#828bb8',
        '#444a73', '#ff8d94', '#c7fb6d', '#ffd8ab',
        '#9ab8ff', '#caabff', '#b2ebff', '#c8d3f5',
      ],
    },
  },
};

/* -------------------------------------------------------------- registry -- */

/**
 * Osuki first because it is the default; the rest alphabetically, because any
 * other order is an opinion about which community theme is best.
 */
export const THEME_PACKS: readonly ThemePack[] = [
  osuki,
  DEVELOPER_THEME_PACKS_BY_ID.ayu,
  DEVELOPER_THEME_PACKS_2026_BY_ID.bamboo,
  DEVELOPER_THEME_PACKS_2026_BY_ID.bluloco,
  catppuccin,
  DEVELOPER_THEME_PACKS_2026_BY_ID.cyberdream,
  DEVELOPER_THEME_PACKS_BY_ID.dracula,
  DEVELOPER_THEME_PACKS_2026_BY_ID.edge,
  everforest,
  DEVELOPER_THEME_PACKS_BY_ID.flexoki,
  DEVELOPER_THEME_PACKS_BY_ID.github,
  DEVELOPER_THEME_PACKS_BY_ID.gruvbox,
  DEVELOPER_THEME_PACKS_2026_BY_ID.iceberg,
  DEVELOPER_THEME_PACKS_BY_ID.kanagawa,
  DEVELOPER_THEME_PACKS_2026_BY_ID.kanso,
  DEVELOPER_THEME_PACKS_2026_BY_ID.material,
  DEVELOPER_THEME_PACKS_2026_BY_ID.melange,
  DEVELOPER_THEME_PACKS_2026_BY_ID.monokaiPro,
  DEVELOPER_THEME_PACKS_2026_BY_ID.modus,
  DEVELOPER_THEME_PACKS_2026_BY_ID.neovim,
  DEVELOPER_THEME_PACKS_2026_BY_ID.nightfox,
  DEVELOPER_THEME_PACKS_BY_ID.nightOwl,
  DEVELOPER_THEME_PACKS_2026_BY_ID.oxocarbon,
  DEVELOPER_THEME_PACKS_2026_BY_ID.osakaJade,
  DEVELOPER_THEME_PACKS_2026_BY_ID.paperColor,
  rosePine,
  DEVELOPER_THEME_PACKS_2026_BY_ID.selenized,
  DEVELOPER_THEME_PACKS_BY_ID.solarized,
  tokyoNight,
  DEVELOPER_THEME_PACKS_2026_BY_ID.tomorrow,
  DEVELOPER_THEME_PACKS_2026_BY_ID.vsCode2026,
  DEVELOPER_THEME_PACKS_2026_BY_ID.zenwritten,
];

export const DEFAULT_THEME_PACK_ID: ThemePackId = 'osuki';

export function isThemePackId(value: unknown): value is ThemePackId {
  return typeof value === 'string' && THEME_PACK_IDS.includes(value as ThemePackId);
}

/**
 * The one way into the registry. Anything unrecognised -- a pack we dropped, a
 * hand-edited settings blob, a build that shipped before a pack existed -- lands
 * on the default rather than on `undefined`, so no caller has to handle a theme
 * that isn't there.
 */
export function resolveThemePack(id: unknown): ThemePack {
  if (isThemePackId(id)) {
    const found = THEME_PACKS.find((pack) => pack.id === id);
    if (found) return found;
  }
  return osuki;
}

export function themeVariant(pack: ThemePack, mode: 'light' | 'dark'): ThemeVariant {
  return mode === 'dark' ? pack.dark : pack.light;
}

/**
 * The four chips the settings row draws. Derived from the pack rather than
 * listed beside it, so a swatch can never drift from the theme it advertises.
 * Canvas first for the overall cast, then the three hues far enough apart to
 * tell two packs apart at 16pt: accent, link, warning.
 */
export function themeSwatch(pack: ThemePack, mode: 'light' | 'dark'): readonly string[] {
  const { colors } = themeVariant(pack, mode);
  return [colors.background, colors.primary, colors.info, colors.warning];
}
