/**
 * Ten paired palettes from developer tools and editor themes.
 *
 * Each seed is a Base16-shaped row of published colours: background steps,
 * foreground steps, then red/orange/yellow/green/cyan/blue/magenta/brown. The
 * adapter only assigns those literal bytes to Muqun roles; it never blends or
 * lightens them. Keeping the source beside each pair makes palette updates
 * auditable without making the main registry another thousand-line file.
 */
import type { AnsiPalette, ThemePack, ThemeVariant } from '@/constants/theme-packs';

export type DeveloperThemePalette = readonly [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
];

export type DeveloperThemeVariantSeed = {
  mode: 'light' | 'dark';
  palette: DeveloperThemePalette;
  onPrimary: string;
  primarySubtle: string;
  dangerSubtle: string;
  terminal?: Partial<ThemeVariant['terminal']>;
};

export function developerThemeVariant(seed: DeveloperThemeVariantSeed): ThemeVariant {
  const [
    base00, base01, base02, base03, base04, base05, base06, base07,
    red, , yellow, green, cyan, blue, magenta,
  ] = seed.palette;
  const isLight = seed.mode === 'light';
  const text = isLight ? base07 : base06;

  const ansi: AnsiPalette = isLight
    ? [
        base07, red, green, yellow, blue, magenta, cyan, base05,
        base04, red, green, yellow, blue, magenta, cyan, base00,
      ]
    : [
        base00, red, green, yellow, blue, magenta, cyan, base05,
        base03, red, green, yellow, blue, magenta, cyan, base07,
      ];

  return {
    colors: {
      background: base00,
      surface: base01,
      surfaceRaised: base02,
      border: base03,
      borderStrong: base04,
      text,
      textMuted: base05,
      textSubtle: base04,
      textDisabled: base03,
      primary: blue,
      onPrimary: seed.onPrimary,
      primarySubtle: seed.primarySubtle,
      danger: red,
      dangerSubtle: seed.dangerSubtle,
      success: green,
      warning: yellow,
      info: cyan,
    },
    terminal: {
      background: base00,
      foreground: text,
      cursor: text,
      link: blue,
      selection: base02,
      ansi,
      ...seed.terminal,
    },
  };
}

const ayu: ThemePack = {
  id: 'ayu',
  label: 'Ayu',
  source: 'https://github.com/ayu-theme/ayu-colors + tinted-theming/schemes',
  lightName: 'Light',
  darkName: 'Dark',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#f8f9fa', '#edeff1', '#d2d4d8', '#a0a6ac',
      '#8a9199', '#5c6166', '#4e5257', '#404447',
      '#f07171', '#fa8d3e', '#f2ae49', '#6cbf49',
      '#4cbf99', '#035bd6', '#a37acc', '#e6ba7e',
    ],
    onPrimary: '#f8f9fa',
    primarySubtle: 'rgba(3, 91, 214, 0.14)',
    dangerSubtle: 'rgba(240, 113, 113, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#0b0e14', '#131721', '#202229', '#3e4b59',
      '#bfbdb6', '#e6e1cf', '#ece8db', '#f2f0e7',
      '#f07178', '#ff8f40', '#ffb454', '#aad94c',
      '#95e6cb', '#59c2ff', '#d2a6ff', '#e6b450',
    ],
    onPrimary: '#0b0e14',
    primarySubtle: 'rgba(89, 194, 255, 0.24)',
    dangerSubtle: 'rgba(240, 113, 120, 0.16)',
  }),
};

const dracula: ThemePack = {
  id: 'dracula',
  label: 'Dracula',
  source: 'https://github.com/dracula/dracula-theme + dracula/visual-studio-code',
  lightName: 'Alucard',
  darkName: 'Dracula',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#fffbeb', '#f8f8f2', '#cfcfde', '#b8b8ca',
      '#846e15', '#6c664b', '#1f1f1f', '#111111',
      '#cb3a2a', '#a34d14', '#846e15', '#14710a',
      '#036a96', '#644ac9', '#a3144d', '#a34d14',
    ],
    onPrimary: '#fffbeb',
    primarySubtle: 'rgba(100, 74, 201, 0.14)',
    dangerSubtle: 'rgba(203, 58, 42, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#282a36', '#343746', '#44475a', '#191a21',
      '#6272a4', '#bd93f9', '#f8f8f2', '#ffffff',
      '#ff5555', '#ffb86c', '#f1fa8c', '#50fa7b',
      '#8be9fd', '#bd93f9', '#ff79c6', '#ffb86c',
    ],
    onPrimary: '#282a36',
    primarySubtle: 'rgba(189, 147, 249, 0.24)',
    dangerSubtle: 'rgba(255, 85, 85, 0.16)',
    terminal: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selection: '#44475a',
      ansi: [
        '#21222c', '#ff5555', '#50fa7b', '#f1fa8c',
        '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5',
        '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
      ],
    },
  }),
};

const flexoki: ThemePack = {
  id: 'flexoki',
  label: 'Flexoki',
  source: 'https://github.com/kepano/flexoki',
  lightName: 'Light',
  darkName: 'Dark',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#fffcf0', '#f2f0e5', '#e6e4d9', '#cecdc3',
      '#9f9d96', '#403e3c', '#282726', '#100f0f',
      '#af3029', '#bc5215', '#ad8301', '#66800b',
      '#24837b', '#205ea6', '#5e409d', '#a02f6f',
    ],
    onPrimary: '#fffcf0',
    primarySubtle: 'rgba(32, 94, 166, 0.14)',
    dangerSubtle: 'rgba(175, 48, 41, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#100f0f', '#1c1b1a', '#282726', '#575653',
      '#878580', '#cecdc3', '#e6e4d9', '#fffcf0',
      '#d14d41', '#da702c', '#d0a215', '#879a39',
      '#3aa99f', '#4385be', '#8b7ec8', '#ce5d97',
    ],
    onPrimary: '#100f0f',
    primarySubtle: 'rgba(67, 133, 190, 0.24)',
    dangerSubtle: 'rgba(209, 77, 65, 0.16)',
  }),
};

const github: ThemePack = {
  id: 'github',
  label: 'GitHub',
  source: 'https://github.com/primer/primitives (light/dark)',
  lightName: 'Light',
  darkName: 'Dark',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#ffffff', '#f6f8fa', '#eaeef2', '#d0d7de',
      '#8c959f', '#656d76', '#24292f', '#1f2328',
      '#cf222e', '#bc4c00', '#9a6700', '#1a7f37',
      '#1b7c83', '#0969da', '#8250df', '#bf3989',
    ],
    onPrimary: '#ffffff',
    primarySubtle: 'rgba(9, 105, 218, 0.14)',
    dangerSubtle: 'rgba(207, 34, 46, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#0d1117', '#161b22', '#21262d', '#30363d',
      '#484f58', '#8b949e', '#c9d1d9', '#f0f6fc',
      '#f85149', '#db6d28', '#d29922', '#3fb950',
      '#39c5cf', '#58a6ff', '#bc8cff', '#f778ba',
    ],
    onPrimary: '#0d1117',
    primarySubtle: 'rgba(88, 166, 255, 0.24)',
    dangerSubtle: 'rgba(248, 81, 73, 0.16)',
  }),
};

const gruvbox: ThemePack = {
  id: 'gruvbox',
  label: 'Gruvbox',
  source: 'https://github.com/morhetz/gruvbox (medium)',
  lightName: 'Light Medium',
  darkName: 'Dark Medium',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#fbf1c7', '#ebdbb2', '#d5c4a1', '#bdae93',
      '#665c54', '#504945', '#3c3836', '#282828',
      '#9d0006', '#af3a03', '#b57614', '#79740e',
      '#427b58', '#076678', '#8f3f71', '#d65d0e',
    ],
    onPrimary: '#fbf1c7',
    primarySubtle: 'rgba(7, 102, 120, 0.14)',
    dangerSubtle: 'rgba(157, 0, 6, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#282828', '#3c3836', '#504945', '#665c54',
      '#bdae93', '#d5c4a1', '#ebdbb2', '#fbf1c7',
      '#fb4934', '#fe8019', '#fabd2f', '#b8bb26',
      '#8ec07c', '#83a598', '#d3869b', '#d65d0e',
    ],
    onPrimary: '#282828',
    primarySubtle: 'rgba(131, 165, 152, 0.24)',
    dangerSubtle: 'rgba(251, 73, 52, 0.16)',
  }),
};

const kanagawa: ThemePack = {
  id: 'kanagawa',
  label: 'Kanagawa',
  source: 'https://github.com/rebelot/kanagawa.nvim (Lotus/Wave)',
  lightName: 'Lotus',
  darkName: 'Wave',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#f2ecbc', '#e5ddb0', '#d5cea3', '#c9cbd1',
      '#8a8980', '#545464', '#716e61', '#43436c',
      '#c84053', '#cc6d00', '#77713f', '#6f894e',
      '#597b75', '#4d699b', '#b35b79', '#624c83',
    ],
    onPrimary: '#f2ecbc',
    primarySubtle: 'rgba(77, 105, 155, 0.14)',
    dangerSubtle: 'rgba(200, 64, 83, 0.12)',
    terminal: {
      background: '#f2ecbc',
      foreground: '#545464',
      cursor: '#43436c',
      selection: '#c9cbd1',
      ansi: [
        '#1f1f28', '#c84053', '#6f894e', '#77713f',
        '#4d699b', '#b35b79', '#597b75', '#545464',
        '#8a8980', '#d7474b', '#6e915f', '#836f4a',
        '#6693bf', '#624c83', '#5e857a', '#43436c',
      ],
    },
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#1f1f28', '#2a2a37', '#363646', '#54546d',
      '#727169', '#c8c093', '#dcd7ba', '#f2ecbc',
      '#c34043', '#ffa066', '#c0a36e', '#98bb6c',
      '#7aa89f', '#7e9cd8', '#957fb8', '#d27e99',
    ],
    onPrimary: '#1f1f28',
    primarySubtle: 'rgba(126, 156, 216, 0.24)',
    dangerSubtle: 'rgba(195, 64, 67, 0.16)',
    terminal: {
      background: '#1f1f28',
      foreground: '#dcd7ba',
      cursor: '#c8c093',
      selection: '#2d4f67',
      ansi: [
        '#16161d', '#c34043', '#76946a', '#c0a36e',
        '#7e9cd8', '#957fb8', '#6a9589', '#c8c093',
        '#727169', '#e82424', '#98bb6c', '#e6c384',
        '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba',
      ],
    },
  }),
};

const nightOwl: ThemePack = {
  id: 'night-owl',
  label: 'Night Owl',
  source: 'https://github.com/sdras/night-owl-vscode-theme',
  lightName: 'Light Owl',
  darkName: 'Night Owl',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#fbfbfb', '#f6f6f6', '#f0f0f0', '#d9d9d9',
      '#93a1a1', '#403f53', '#5f7e97', '#111111',
      '#de3d3b', '#c96765', '#daaa01', '#08916a',
      '#2aa298', '#288ed7', '#d6438a', '#994cc3',
    ],
    onPrimary: '#fbfbfb',
    primarySubtle: 'rgba(40, 142, 215, 0.14)',
    dangerSubtle: 'rgba(222, 61, 59, 0.12)',
    terminal: {
      background: '#f6f6f6',
      foreground: '#403f53',
      cursor: '#90a7b2',
      ansi: [
        '#403f53', '#de3d3b', '#08916a', '#e0af02',
        '#288ed7', '#d6438a', '#2aa298', '#93a1a1',
        '#403f53', '#de3d3b', '#08916a', '#daaa01',
        '#288ed7', '#d6438a', '#2aa298', '#93a1a1',
      ],
    },
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#011627', '#01111d', '#0b253a', '#122d42',
      '#4b6479', '#89a4bb', '#d6deeb', '#ffffff',
      '#ef5350', '#f78c6c', '#c5e478', '#22da6e',
      '#21c7a8', '#82aaff', '#c792ea', '#d1aaff',
    ],
    onPrimary: '#011627',
    primarySubtle: 'rgba(130, 170, 255, 0.24)',
    dangerSubtle: 'rgba(239, 83, 80, 0.16)',
    terminal: {
      background: '#011627',
      foreground: '#d6deeb',
      cursor: '#80a4c2',
      selection: '#1d3b53',
      ansi: [
        '#011627', '#ef5350', '#22da6e', '#c5e478',
        '#82aaff', '#c792ea', '#21c7a8', '#ffffff',
        '#575656', '#ef5350', '#22da6e', '#ffeb95',
        '#82aaff', '#c792ea', '#7fdbca', '#ffffff',
      ],
    },
  }),
};

const solarized: ThemePack = {
  id: 'solarized',
  label: 'Solarized',
  source: 'https://github.com/altercation/solarized',
  lightName: 'Light',
  darkName: 'Dark',
  light: developerThemeVariant({
    mode: 'light',
    palette: [
      '#fdf6e3', '#eee8d5', '#ddd6c1', '#93a1a1',
      '#657b83', '#073642', '#586e75', '#002b36',
      '#dc322f', '#cb4b16', '#b58900', '#859900',
      '#2aa198', '#268bd2', '#6c71c4', '#d33682',
    ],
    onPrimary: '#fdf6e3',
    primarySubtle: 'rgba(38, 139, 210, 0.14)',
    dangerSubtle: 'rgba(220, 50, 47, 0.12)',
  }),
  dark: developerThemeVariant({
    mode: 'dark',
    palette: [
      '#002b36', '#073642', '#0e4652', '#586e75',
      '#839496', '#93a1a1', '#eee8d5', '#fdf6e3',
      '#dc322f', '#cb4b16', '#b58900', '#859900',
      '#2aa198', '#268bd2', '#6c71c4', '#d33682',
    ],
    onPrimary: '#002b36',
    primarySubtle: 'rgba(38, 139, 210, 0.24)',
    dangerSubtle: 'rgba(220, 50, 47, 0.16)',
  }),
};

export const DEVELOPER_THEME_PACKS_BY_ID = {
  ayu,
  dracula,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  nightOwl,
  solarized,
} as const;
