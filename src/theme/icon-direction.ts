import type { ThemeIconDirection, ThemeIconName } from './schema';

const ANGLES: Record<ThemeIconDirection, number> = {
  up: 0,
  'up-right': 45,
  right: 90,
  'down-right': 135,
  down: 180,
  'down-left': 225,
  left: 270,
  'up-left': 315,
};

/** Null means the asset cannot safely satisfy the requested direction. */
export function themeIconRotation(
  source: ThemeIconDirection | undefined,
  target: ThemeIconDirection | undefined
): number | null {
  if (!target) return 0;
  if (!source) return null;
  return (ANGLES[target] - ANGLES[source] + 360) % 360;
}

/** One theme glyph a control may draw, pointing where the control needs it. */
export type ThemeIconChoice = { name: ThemeIconName; direction?: ThemeIconDirection };

type IconManifest = {
  icons?: Record<string, { asset: string; render: 'template' | 'original' } | null | undefined>;
  iconDirections?: Record<string, ThemeIconDirection>;
};

/**
 * The first of `choices` the pack can draw: supplied, installed, renderable
 * (`usable`), and drawn in a known direction when one is asked for. Null
 * means none can, and the control draws the app's own glyph.
 */
export function resolveThemeIcon(
  manifest: IconManifest | undefined,
  assets: Record<string, string> | undefined,
  choices: readonly ThemeIconChoice[],
  usable: (uri: string | undefined) => uri is string
): { name: ThemeIconName; uri: string; render: 'template' | 'original'; rotation: number } | null {
  for (const { name, direction } of choices) {
    const icon = manifest?.icons?.[name];
    if (!icon) continue;
    const uri = assets?.[icon.asset];
    if (!usable(uri)) continue;
    const rotation = themeIconRotation(manifest?.iconDirections?.[name], direction);
    if (rotation === null) continue;
    return { name, uri, render: icon.render, rotation };
  }
  return null;
}
