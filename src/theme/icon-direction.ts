import type { ThemeIconDirection } from './schema';

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
