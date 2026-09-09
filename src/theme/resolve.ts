import type { ThemeVariant } from '@/constants/theme-packs';
import { cloneThemeData } from '@/theme/clone';
import type { ThemeImage, ThemeManifest, ThemeSlot } from '@/theme/schema';

export type ResolvedCustomTheme = {
  id: string;
  installationId: string;
  label: string;
  light: ThemeVariant;
  dark: ThemeVariant;
  manifest: ThemeManifest;
};

/** Compile once when installing/loading, not while a terminal is producing output. */
export function compileTheme(manifest: ThemeManifest, installationId: string): ResolvedCustomTheme {
  const owned = cloneThemeData(manifest);
  const theme = {
    id: `custom-${installationId}`,
    installationId,
    label: owned.name,
    light: owned.variants.light,
    dark: owned.variants.dark,
    manifest: owned,
  };
  freezeTree(theme);
  return theme;
}

function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeTree);
  Object.freeze(value);
}

/** Undefined inherits, null explicitly removes an image at that layer. */
export function resolveThemeImage(
  manifest: ThemeManifest,
  slot: ThemeSlot,
  mode: 'light' | 'dark',
  width: 'compact' | 'regular',
  decorationsEnabled = true
): ThemeImage | null {
  if (!decorationsEnabled) return null;
  const variant = manifest.variantDecorations?.[mode]?.[slot];
  const shared = manifest.decoration?.[slot];
  const selected = variant === undefined ? shared : variant;
  if (!selected) return null;
  const responsive = selected[width];
  if (responsive !== undefined) return responsive;
  const { compact: _compact, regular: _regular, ...image } = selected;
  return image;
}

export function resolveHomeIdentity(manifest?: ThemeManifest) {
  const name = manifest?.homeIdentity?.name;
  const logo = manifest?.homeIdentity?.logo;
  return {
    name: name?.mode === 'hidden' ? null : name?.mode === 'custom' ? name.text : 'Muqun',
    logo: logo?.mode === 'hidden' ? null : logo?.mode === 'custom' ? logo.asset : 'builtin',
    showBrand: name?.mode !== 'hidden' || logo?.mode !== 'hidden',
  };
}
