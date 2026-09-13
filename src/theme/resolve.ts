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
  decorationsEnabled = true,
  fallbackSlot?: ThemeSlot
): ThemeImage | null {
  if (!decorationsEnabled) return null;
  const variant = manifest.variantDecorations?.[mode]?.[slot];
  const shared = manifest.decoration?.[slot];
  let selected = variant === undefined ? shared : variant;
  if (selected === undefined && fallbackSlot) {
    const fallbackVariant = manifest.variantDecorations?.[mode]?.[fallbackSlot];
    selected =
      fallbackVariant === undefined ? manifest.decoration?.[fallbackSlot] : fallbackVariant;
  }
  if (!selected) return null;
  const responsive = selected[width];
  if (responsive !== undefined) return responsive;
  const { compact: _compact, regular: _regular, ...image } = selected;
  return image;
}

/**
 * What Home says the app is called, and what mark it shows.
 *
 * A pack that says nothing gets nothing. That is the part worth stating: with
 * no custom theme (`manifest` absent) Home is the app's own -- its mark and its
 * name -- and that has not changed. But once a pack is applied, Home is the
 * pack's: it brought a picture and an identity of its own, and printing the
 * app's logo and tagline over someone's illustration is the app talking across
 * it. So the branding is opt-in for a pack rather than opt-out, and a pack that
 * wants it back asks by declaring `mode: 'default'`.
 *
 * The editor's two switches are the reader's override on top of that, and they
 * write the same explicit `default`/`hidden` a pack would.
 */
export function resolveHomeIdentity(manifest?: ThemeManifest) {
  const name = manifest?.homeIdentity?.name;
  const logo = manifest?.homeIdentity?.logo;
  // Undeclared means hidden for a pack, and means the app's own for no pack.
  const nameHidden = manifest ? name === undefined || name.mode === 'hidden' : false;
  const logoHidden = manifest ? logo === undefined || logo.mode === 'hidden' : false;
  return {
    name: nameHidden ? null : name?.mode === 'custom' ? name.text : 'Muqun',
    logo: logoHidden
      ? null
      : logo?.mode === 'custom'
        ? { mode: 'custom' as const, asset: logo.asset }
        : { mode: 'default' as const },
    showBrand: !nameHidden || !logoHidden,
  };
}
