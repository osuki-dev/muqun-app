import { resolveThemePack } from '@/constants/theme-packs';
import { parseThemeManifest, type ThemeManifest } from '@/theme/schema';

function hexColor(value: string): string {
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) return value.toUpperCase();
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`Unsupported built-in color: ${value}`);
  return `#${[
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Math.round(Number(match[4]) * 255),
  ]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** A complete custom-theme fixture, not a mutable reference to a built-in theme. */
export function createThemeStarter(): ThemeManifest {
  const pack = resolveThemePack('osuki');
  const variant = (mode: 'light' | 'dark') => ({
    colors: Object.fromEntries(
      Object.entries(pack[mode].colors).map(([key, value]) => [key, hexColor(value)])
    ),
    terminal: {
      background: hexColor(pack[mode].terminal.background),
      foreground: hexColor(pack[mode].terminal.foreground),
      cursor: hexColor(pack[mode].terminal.cursor),
      link: hexColor(pack[mode].terminal.link),
      selection: hexColor(pack[mode].terminal.selection),
      ansi: pack[mode].terminal.ansi.map(hexColor),
    },
  });
  const light = variant('light');
  const dark = variant('dark');
  // Built-ins skip the custom-theme contrast audit. Keep this fixture valid for
  // the import, preview and demo paths that intentionally exercise that audit.
  light.terminal = { ...light.terminal, link: '#3455DC', cursor: '#C54337' };
  light.colors = {
    ...light.colors,
    textSubtle: '#5A6272',
    onPrimary: '#FFFFFF',
    primary: '#A62A18',
    primarySubtle: '#A62A180F',
    danger: '#9E1F14',
    dangerSubtle: '#9E1F140F',
    success: '#177A53',
    warning: '#8A5710',
  };
  dark.colors = {
    ...dark.colors,
    primarySubtle: '#FF5A4A1F',
    dangerSubtle: '#F2554A14',
  };
  return parseThemeManifest(
    JSON.stringify({
      format: 'muqun-theme',
      schemaVersion: 1,
      id: 'my-theme',
      name: 'My theme',
      version: '1.0.0',
      variants: { light, dark },
    })
  );
}
