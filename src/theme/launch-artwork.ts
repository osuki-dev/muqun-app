import type { ResolvedCustomTheme } from '@/theme/resolve';
import { resolveHomeIdentity, resolveThemeImage } from '@/theme/resolve';

export type LaunchArtwork =
  | { kind: 'artwork'; uri: string }
  | { kind: 'logo'; uri: string }
  | { kind: 'default' };

/**
 * Launch and lock share the theme's explicit launch override, then its primary
 * Home artwork, then its brand mark. Home visibility does not hide artwork on
 * these separate surfaces. Only installed, app-owned assets may be rendered.
 */
export function resolveLaunchArtwork(
  theme: ResolvedCustomTheme | null | undefined,
  assets: Record<string, string> | undefined,
  mode: 'light' | 'dark',
  width: 'compact' | 'regular' = 'compact'
): LaunchArtwork {
  if (!theme || !assets) return { kind: 'default' };

  for (const slot of ['launch.artwork', 'home.artwork'] as const) {
    const image = resolveThemeImage(theme.manifest, slot, mode, width, true);
    const uri = image ? ownedAsset(assets, image.asset) : undefined;
    if (uri) return { kind: 'artwork', uri };
  }

  const logo = resolveHomeIdentity(theme.manifest).logo;
  const logoUri = logo?.mode === 'custom' ? ownedAsset(assets, logo.asset) : undefined;
  if (logoUri) return { kind: 'logo', uri: logoUri };
  return { kind: 'default' };
}

/** The applied theme's paper, or the bundled splash background without a theme. */
export function resolveLaunchBackground(
  theme: ResolvedCustomTheme | null | undefined,
  mode: 'light' | 'dark'
): string | null {
  return theme ? theme[mode].colors.background : null;
}

function ownedAsset(assets: Record<string, string>, id: string): string | undefined {
  const uri = assets[id];
  return uri?.startsWith('file:///') ? uri : undefined;
}
