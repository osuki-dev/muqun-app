/**
 * Nineteen paired developer palettes, researched and re-checked in 2026.
 * Two replace visually overlapping packs, so the registry grows by seventeen.
 *
 * The source URL on every pack points at the upstream project or the exact
 * palette file. Muqun maps those published colours onto its UI roles; these
 * are compatibility adaptations, not releases made by the theme authors.
 */
import {
  developerThemeVariant,
  type DeveloperThemePalette,
} from '@/constants/developer-theme-packs';
import type { ThemePack } from '@/constants/theme-packs';

type PairSeed = {
  id: ThemePack['id'];
  label: string;
  source: string;
  lightName: string;
  darkName: string;
  light: DeveloperThemePalette;
  dark: DeveloperThemePalette;
  lightOnPrimary: string;
  darkOnPrimary: string;
  lightTerminal?: Partial<ThemePack['light']['terminal']>;
  darkTerminal?: Partial<ThemePack['dark']['terminal']>;
};

function rgb(hex: string): string {
  const value = hex.slice(1);
  return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
}

function pairedPack(seed: PairSeed): ThemePack {
  const lightPrimary = seed.light[13];
  const darkPrimary = seed.dark[13];
  return {
    id: seed.id,
    label: seed.label,
    source: seed.source,
    lightName: seed.lightName,
    darkName: seed.darkName,
    light: developerThemeVariant({
      mode: 'light',
      palette: seed.light,
      onPrimary: seed.lightOnPrimary,
      primarySubtle: `rgba(${rgb(lightPrimary)}, 0.14)`,
      dangerSubtle: `rgba(${rgb(seed.light[8])}, 0.12)`,
      terminal: seed.lightTerminal,
    }),
    dark: developerThemeVariant({
      mode: 'dark',
      palette: seed.dark,
      onPrimary: seed.darkOnPrimary,
      primarySubtle: `rgba(${rgb(darkPrimary)}, 0.24)`,
      dangerSubtle: `rgba(${rgb(seed.dark[8])}, 0.16)`,
      terminal: seed.darkTerminal,
    }),
  };
}

const bamboo = pairedPack({
  id: 'bamboo',
  label: 'Bamboo',
  source: 'https://github.com/ribru17/bamboo.nvim',
  lightName: 'Light',
  darkName: 'Vulgaris',
  light: [
    '#fafae0', '#fff8f0', '#eaead0', '#dadac2',
    '#838781', '#5d665b', '#3a4238', '#252623',
    '#c72a3c', '#df5926', '#a77b00', '#27850b',
    '#188a9e', '#1745d5', '#8a4adf', '#c05050',
  ],
  dark: [
    '#252623', '#2f312c', '#383b35', '#5b5e5a',
    '#838781', '#b8b29f', '#f1e9d2', '#ffffff',
    '#e75a7c', '#ff9966', '#dbb651', '#8fb573',
    '#70c2be', '#57a5e5', '#aaaaff', '#f08080',
  ],
  lightOnPrimary: '#fff8f0',
  darkOnPrimary: '#111210',
});

const bluloco = pairedPack({
  id: 'bluloco',
  label: 'Bluloco',
  source: 'https://github.com/uloco/bluloco.nvim',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#f7f7f7', '#ffffff', '#dddee8', '#cbccd4',
    '#6f6f74', '#525257', '#38383a', '#000000',
    '#c80d41', '#d44d16', '#a36600', '#208839',
    '#1e4d7a', '#1d44dd', '#6d1bed', '#640620',
  ],
  dark: [
    '#1e2027', '#272a33', '#343844', '#494f5c',
    '#7b8494', '#969faf', '#ccd5e4', '#fefefe',
    '#f71041', '#fc7e57', '#f5b74b', '#23974a',
    '#366f99', '#285afe', '#8c62fd', '#7b0820',
  ],
  lightOnPrimary: '#f7f7f7',
  darkOnPrimary: '#fefefe',
});

const cyberdream = pairedPack({
  id: 'cyberdream',
  label: 'Cyberdream',
  source: 'https://github.com/scottmckendry/cyberdream.nvim',
  lightName: 'Light',
  darkName: 'Default',
  light: [
    '#ffffff', '#f5f5f5', '#eaeaea', '#c7c7c7',
    '#7b8496', '#505765', '#2d3038', '#16181a',
    '#d11500', '#d17c00', '#997b00', '#008b0c',
    '#008c99', '#0057d1', '#a018ff', '#f40064',
  ],
  dark: [
    '#16181a', '#1e2124', '#3c4048', '#525966',
    '#7b8496', '#a8b0bf', '#e6e8eb', '#ffffff',
    '#ff6e5e', '#ffbd5e', '#f1ff5e', '#5eff6c',
    '#5ef1ff', '#5ea1ff', '#bd5eff', '#ff5ea0',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#16181a',
});

const edge = pairedPack({
  id: 'edge',
  label: 'Edge',
  source: 'https://github.com/sainnhe/edge',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#fafafa', '#f2f3f5', '#e3e5e8', '#c7cad0',
    '#717781', '#555b65', '#3a3a46', '#2e2e38',
    '#db7070', '#cf7d12', '#9a7b00', '#5d7f30',
    '#267b73', '#4b6da5', '#9a4daf', '#8e5a4d',
  ],
  dark: [
    '#262729', '#313235', '#3d3f42', '#4a4c4f',
    '#777b80', '#a5a8ac', '#caccce', '#e4e5e6',
    '#e77171', '#e69b15', '#dbb774', '#a1bf78',
    '#5ebaa5', '#73b3e7', '#d390e7', '#b88f74',
  ],
  lightOnPrimary: '#fafafa',
  darkOnPrimary: '#262729',
});

const iceberg = pairedPack({
  id: 'iceberg',
  label: 'Iceberg',
  source: 'https://github.com/cocopon/iceberg.vim',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#e8e9ec', '#dcdfe7', '#cad0de', '#bec0c9',
    // Iceberg's #606374 misses 4.5:1 on its own #dcdfe7 surface by 0.04;
    // this three-channel nudge preserves the hue while clearing body text.
    '#8389a3', '#5f626f', '#262a3f', '#33374c',
    '#cc517a', '#c57339', '#b6662d', '#668e3d',
    '#3f83a6', '#2d539e', '#7759b4', '#85512c',
  ],
  dark: [
    '#161821', '#1e2132', '#272c42', '#3d425b',
    '#6b7089', '#9a9ca5', '#c6c8d1', '#d2d4de',
    '#e27878', '#e2a478', '#e9b189', '#b4be82',
    '#89b8c2', '#84a0c6', '#a093c7', '#d2a478',
  ],
  lightOnPrimary: '#e8e9ec',
  darkOnPrimary: '#161821',
  lightTerminal: {
    ansi: [
      '#dcdfe7', '#cc517a', '#668e3d', '#c57339',
      '#2d539e', '#7759b4', '#3f83a6', '#33374c',
      '#8389a3', '#cc3768', '#598030', '#b6662d',
      '#22478e', '#6845ad', '#327698', '#262a3f',
    ],
  },
  darkTerminal: {
    ansi: [
      '#1e2132', '#e27878', '#b4be82', '#e2a478',
      '#84a0c6', '#a093c7', '#89b8c2', '#c6c8d1',
      '#6b7089', '#e98989', '#c0ca8e', '#e9b189',
      '#91acd1', '#ada0d3', '#95c4ce', '#d2d4de',
    ],
  },
});

const kanso = pairedPack({
  id: 'kanso',
  label: 'Kanso',
  source: 'https://github.com/webhooked/kanso.nvim',
  lightName: 'Pearl',
  darkName: 'Ink',
  light: [
    '#f2f1ef', '#e2e1df', '#dddddb', '#cacac7',
    '#9f9f99', '#545464', '#43436c', '#22262d',
    '#c84053', '#cc6d00', '#77713f', '#6f894e',
    '#597b75', '#4d699b', '#b35b79', '#836f4a',
  ],
  dark: [
    '#14171d', '#1f1f26', '#22262d', '#393b44',
    '#717c7c', '#a4a7a4', '#c5c9c7', '#f2f1ef',
    '#c34043', '#b6927b', '#dca561', '#98bb6c',
    '#8ea4a2', '#7fb4ca', '#938aa9', '#b98d7b',
  ],
  lightOnPrimary: '#f2f1ef',
  darkOnPrimary: '#14171d',
  lightTerminal: {
    ansi: [
      '#22262d', '#c84053', '#6f894e', '#77713f',
      '#4d699b', '#b35b79', '#597b75', '#545464',
      '#6d6f6e', '#d7474b', '#6e915f', '#836f4a',
      '#6693bf', '#624c83', '#5e857a', '#43436c',
    ],
  },
  darkTerminal: {
    ansi: [
      '#14171d', '#c4746e', '#8a9a7b', '#c4b28a',
      '#8ba4b0', '#a292a3', '#8ea4a2', '#c8c093',
      '#a4a7a4', '#e46876', '#87a987', '#e6c384',
      '#7fb4ca', '#938aa9', '#7aa89f', '#c5c9c7',
    ],
  },
});

const material = pairedPack({
  id: 'material',
  label: 'Material',
  source: 'https://github.com/marko-cerovac/material.nvim',
  lightName: 'Lighter',
  darkName: 'Darker',
  light: [
    '#fafafa', '#ffffff', '#e7eaec', '#ccd7da',
    '#8796b0', '#59677d', '#374151', '#000000',
    '#d93654', '#d84f2d', '#9b6900', '#527a25',
    '#16757b', '#526f9e', '#6e42dc', '#a52a2a',
  ],
  dark: [
    '#212121', '#303030', '#353535', '#4a4a4a',
    '#82959d', '#b2ccd6', '#eeffff', '#ffffff',
    '#f07178', '#f78c6c', '#ffcb6b', '#c3e88d',
    '#89ddff', '#82aaff', '#c792ea', '#ff5370',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#212121',
});

const monokaiPro = pairedPack({
  id: 'monokai-pro',
  label: 'Monokai Pro',
  source: 'https://github.com/loctvl842/monokai-pro.nvim',
  lightName: 'Light',
  darkName: 'Ristretto',
  light: [
    '#faf4f2', '#fffaf8', '#ede7e5', '#d3cdcc',
    '#918c8e', '#706b6e', '#4d484e', '#29242a',
    '#c92f5f', '#c7461e', '#9a5a00', '#157a4b',
    '#08728c', '#5a449f', '#7058be', '#8e4b3a',
  ],
  dark: [
    '#2c2525', '#211c1c', '#403838', '#5b5353',
    '#72696a', '#c3b7b8', '#e6d9db', '#fff1f3',
    '#fd6883', '#fb9a77', '#f9cc6c', '#adda78',
    '#85dacc', '#f38d70', '#a8a9eb', '#7d4d3b',
  ],
  lightOnPrimary: '#faf4f2',
  darkOnPrimary: '#2c2525',
});

const melange = pairedPack({
  id: 'melange',
  label: 'Mélange',
  source: 'https://github.com/savq/melange-nvim',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#f1f1f1', '#e9e1db', '#d9d3ce', '#bda99b',
    '#7d6658', '#6a5448', '#54433a', '#342923',
    '#bf0021', '#bc5c00', '#806000', '#3a684a',
    '#3d6568', '#465aa4', '#904180', '#8c4d2f',
  ],
  dark: [
    '#292522', '#34302c', '#403a36', '#5d5147',
    '#867462', '#c1a78e', '#ece1d7', '#fff8f0',
    '#d47766', '#e49b5d', '#ebc06d', '#85b695',
    '#89b3b6', '#a3a9ce', '#cf9bc2', '#bd8183',
  ],
  lightOnPrimary: '#f1f1f1',
  darkOnPrimary: '#292522',
});

const modus = pairedPack({
  id: 'modus',
  label: 'Modus',
  source: 'https://github.com/protesilaos/modus-themes',
  lightName: 'Operandi',
  darkName: 'Vivendi',
  light: [
    '#ffffff', '#f2f2f2', '#e0e0e0', '#bfbfbf',
    '#7f7f7f', '#595959', '#193668', '#000000',
    '#a60000', '#813e00', '#6f5500', '#006800',
    '#005e8b', '#0031a9', '#721045', '#8f5040',
  ],
  dark: [
    '#000000', '#1e1e1e', '#303030', '#535353',
    '#7f7f7f', '#989898', '#c6daff', '#ffffff',
    '#ff5f59', '#fec43f', '#d0bc00', '#44bc44',
    '#00d3d0', '#2fafff', '#b6a0ff', '#feacd0',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#000000',
});

const neovim = pairedPack({
  id: 'neovim',
  label: 'Neovim',
  source: 'https://github.com/neovim/neovim/blob/master/src/nvim/highlight_group.c',
  lightName: 'Default Light',
  darkName: 'Default Dark',
  light: [
    '#e0e2ea', '#eef1f8', '#d1d4dc', '#9b9ea4',
    '#65686f', '#4f5258', '#2c2e33', '#07080d',
    '#590008', '#8b4513', '#6b5300', '#005523',
    '#007373', '#004c73', '#470045', '#a52a2a',
  ],
  dark: [
    '#14161b', '#07080d', '#272a31', '#4f5258',
    '#777a81', '#9b9ea4', '#e0e2ea', '#eef1f8',
    '#ffc0b9', '#ffa500', '#fce094', '#b3f6c0',
    '#8cf8f7', '#a6dbff', '#ffcaff', '#cd853f',
  ],
  lightOnPrimary: '#eef1f8',
  darkOnPrimary: '#14161b',
});

const nightfox = pairedPack({
  id: 'nightfox',
  label: 'Nightfox',
  source: 'https://github.com/EdenEast/nightfox.nvim',
  lightName: 'Dayfox',
  darkName: 'Nightfox',
  light: [
    '#f6f2ee', '#eae3dc', '#ddd4cc', '#b8aea5',
    '#837a72', '#615b56', '#3d2b5a', '#1d344f',
    '#a5222f', '#955f61', '#8a5d00', '#396847',
    '#287980', '#2848a9', '#6e33ce', '#824d5b',
  ],
  dark: [
    '#131a24', '#192330', '#212e3f', '#39506d',
    '#526a86', '#aeafb0', '#cdcecf', '#dfdfe0',
    '#c94f6d', '#f4a261', '#dbc074', '#81b29a',
    '#63cdcf', '#719cd6', '#9d79d6', '#d67ad2',
  ],
  lightOnPrimary: '#f6f2ee',
  darkOnPrimary: '#131a24',
});

const oxocarbon = pairedPack({
  id: 'oxocarbon',
  label: 'Oxocarbon',
  source: 'https://github.com/nyoom-engineering/oxocarbon.nvim',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#f2f4f8', '#ffffff', '#dde1e6', '#bec6cf',
    '#68788d', '#525f70', '#3d4652', '#272d35',
    '#d83b82', '#b84b00', '#8c6900', '#198038',
    '#673ab7', '#0f62fe', '#8a3ffc', '#803800',
  ],
  dark: [
    '#161616', '#262626', '#393939', '#525252',
    '#8d8d8d', '#a8a8a8', '#f2f4f8', '#ffffff',
    '#ee5396', '#ff7eb6', '#ffab91', '#42be65',
    '#3ddbd9', '#33b1ff', '#be95ff', '#82cfff',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#161616',
});

const osakaJade = pairedPack({
  id: 'osaka-jade',
  label: 'Osaka Jade',
  source: 'https://github.com/sspaeti/obsidian_osaka_jade',
  lightName: 'Light',
  darkName: 'Omarchy',
  light: [
    '#f2efe9', '#f8f8f8', '#edebd9', '#c7c5b3',
    '#7a887d', '#53685b', '#2f4a37', '#1a2e20',
    '#c9453b', '#b85b3e', '#74824d', '#4e815f',
    '#407a6f', '#3e6b62', '#a33f70', '#8a5b43',
  ],
  dark: [
    '#111c18', '#0c1512', '#23372b', '#32473b',
    '#53685b', '#81b8a8', '#c1c497', '#f7e8b2',
    '#ff5345', '#e67d64', '#e5c736', '#549e6a',
    '#2dd5b7', '#509475', '#d2689c', '#a2734b',
  ],
  lightOnPrimary: '#f2efe9',
  darkOnPrimary: '#111c18',
});

const paperColor = pairedPack({
  id: 'papercolor',
  label: 'PaperColor',
  source: 'https://github.com/NLKNguyen/papercolor-theme',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#eeeeee', '#ffffff', '#d7d7d7', '#bcbcbc',
    '#858585', '#666666', '#525252', '#262626',
    '#d70000', '#af5f00', '#875f00', '#008700',
    '#0087af', '#005f87', '#8700af', '#af0000',
  ],
  dark: [
    '#1c1c1c', '#262626', '#363636', '#585858',
    '#808080', '#9e9e9e', '#d0d0d0', '#eeeeee',
    '#ff5faf', '#d7af5f', '#ffaf00', '#5faf5f',
    '#00afaf', '#5fafd7', '#af87d7', '#af005f',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#1c1c1c',
});

const selenized = pairedPack({
  id: 'selenized',
  label: 'Selenized',
  source: 'https://github.com/jan-warchol/selenized/blob/master/the-values.md',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#fbf3db', '#ece3cc', '#d5cdb6', '#b9b19d',
    '#737c79', '#53676d', '#3a4d53', '#112e38',
    '#cc1729', '#bc5819', '#8c6d00', '#428b00',
    '#007f75', '#006dce', '#825dc0', '#c44392',
  ],
  dark: [
    '#103c48', '#184956', '#2d5b69', '#456b76',
    '#72898f', '#adbcbc', '#cad8d9', '#ffffff',
    '#fa5750', '#ed8649', '#dbb32d', '#75b938',
    '#41c7b9', '#4695f7', '#af88eb', '#f275be',
  ],
  lightOnPrimary: '#fbf3db',
  darkOnPrimary: '#103c48',
});

const tomorrow = pairedPack({
  id: 'tomorrow',
  label: 'Tomorrow',
  source: 'https://github.com/chriskempson/tomorrow-theme',
  lightName: 'Tomorrow',
  darkName: 'Tomorrow Night',
  light: [
    '#ffffff', '#f4f4f4', '#e0e0e0', '#c5c8c6',
    '#969896', '#5f6268', '#373b41', '#1d1f21',
    '#c82829', '#a84b0f', '#8f7200', '#597000',
    '#277b80', '#315d99', '#8959a8', '#a3685a',
  ],
  dark: [
    '#1d1f21', '#282a2e', '#373b41', '#4d5057',
    '#73767c', '#969896', '#e0e0e0', '#ffffff',
    '#cc6666', '#de935f', '#f0c674', '#b5bd68',
    '#8abeb7', '#81a2be', '#b294bb', '#a3685a',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#1d1f21',
});

const vsCode2026 = pairedPack({
  id: 'vs-code-2026',
  label: 'VS Code 2026',
  source: 'https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults/themes',
  lightName: '2026 Light',
  darkName: '2026 Dark',
  light: [
    '#ffffff', '#fafafd', '#f0f0f3', '#d8d8dc',
    '#8b8b8f', '#606064', '#3d3d40', '#202020',
    '#ad0707', '#953800', '#667309', '#388a34',
    '#0a6b70', '#0069cc', '#8250df', '#8b326c',
  ],
  dark: [
    '#121314', '#191a1b', '#242526', '#333536',
    '#616365', '#8c8c8c', '#bfbfbf', '#ffffff',
    '#f48771', '#ffa657', '#e5ba7d', '#86cf86',
    '#6bcbd1', '#48a0c7', '#d2a8ff', '#e184aa',
  ],
  lightOnPrimary: '#ffffff',
  darkOnPrimary: '#121314',
});

const zenwritten = pairedPack({
  id: 'zenwritten',
  label: 'Zenwritten',
  source: 'https://github.com/zenbones-theme/zenbones.nvim',
  lightName: 'Light',
  darkName: 'Dark',
  light: [
    '#eeeeee', '#f7f7f7', '#d7d7d7', '#c6c3c3',
    '#777777', '#5c5c5c', '#454545', '#353535',
    '#a8334c', '#944927', '#7a5b22', '#4f6c31',
    '#3b8992', '#286486', '#88507d', '#803d1c',
  ],
  dark: [
    '#191919', '#242424', '#2a2a2a', '#404040',
    '#6b6b6b', '#8e8e8e', '#bbbbbb', '#e5e5e5',
    '#de6e7c', '#b77e64', '#c49a70', '#819b69',
    '#66a5ad', '#6099c0', '#b279a7', '#d68c67',
  ],
  lightOnPrimary: '#eeeeee',
  darkOnPrimary: '#191919',
});

export const DEVELOPER_THEME_PACKS_2026_BY_ID = {
  bamboo,
  bluloco,
  cyberdream,
  edge,
  iceberg,
  kanso,
  material,
  melange,
  monokaiPro,
  modus,
  neovim,
  nightfox,
  oxocarbon,
  osakaJade,
  paperColor,
  selenized,
  tomorrow,
  vsCode2026,
  zenwritten,
} as const;
