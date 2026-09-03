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

export const DEVELOPER_THEME_PACKS_2026_BY_ID = {
  bluloco,
  cyberdream,
  edge,
  iceberg,
  material,
  monokaiPro,
  modus,
  neovim,
  nightfox,
  oxocarbon,
  osakaJade,
} as const;
