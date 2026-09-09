import type { ThemeManifest } from './schema';

export type ThemeSurface = 'navigation' | 'composer' | 'actions';

/** Resolve only the current surface, never disable every material for unrelated artwork. */
export function resolveThemeMaterial(
  manifest: ThemeManifest | undefined,
  surface: ThemeSurface,
  hasImage: boolean,
  glassAvailable: boolean
): 'auto' | 'solid' | 'glass' {
  const requested = manifest?.materials?.[surface] ?? manifest?.materials?.default ?? 'auto';
  if (requested === 'solid') return 'solid';
  if (requested === 'glass') return glassAvailable ? 'glass' : 'solid';
  return hasImage ? 'solid' : 'auto';
}
