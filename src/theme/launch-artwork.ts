import type { ResolvedCustomTheme } from '@/theme/resolve';
import { resolveHomeIdentity, resolveThemeImage } from '@/theme/resolve';

/**
 * What the launch overlay and the lock screen draw in place of the app's mark.
 *
 * `default` means the bundled `loading-mark.png`, which is the only answer the
 * two screens had before: they are the app's own furniture, drawn before any
 * screen exists, so they were pinned to the app's identity even while every
 * surface behind them wore someone's pack.
 */
export type LaunchArtwork =
  | { kind: 'illustration'; uri: string }
  | { kind: 'logo'; uri: string }
  | { kind: 'default' };

/**
 * Which image a launch surface shows for the theme currently applied.
 *
 * The order is illustration, then logo, then the bundled mark, and it is an
 * order rather than a preference because the two candidates mean different
 * things. `emptyState.illustration` is the one slot in the contract that is
 * already defined as a square piece of artwork shown on its own against the
 * theme's paper -- exactly the shape of a splash and of the lock frame -- so a
 * pack that has one has already drawn the picture these screens want. The home
 * logo is a mark rather than a picture, and it is second because a pack may
 * carry one for the header without intending it to fill a launch screen; it is
 * still a far better answer than the app's own mark on a stranger's theme.
 *
 * Pure, and separate from both components, because "which image" is the whole
 * of what the two screens share: the splash floor and the lock frame have
 * nothing else in common, and the fallback chain is the part that must not
 * drift between them.
 *
 * Three things decide the result and all three arrive as arguments:
 *
 * - The reader's `Show Home logo` switch is not one of them, because it has
 *   already been applied. `ThemeRepository.active()` compiles
 *   `effectiveThemeManifest`, which rewrites `homeIdentity.logo` to
 *   `{ mode: 'hidden' }` when the preference is set, so a hidden logo reaches
 *   here as an authored hidden logo and both fall through to the mark.
 * - `assets` is the installation's own map of app-owned files. Only a
 *   `file:///` entry is accepted, the same rule `ThemeArtwork` applies: an
 *   author's URL is never rendered, and a slot whose asset failed to install
 *   is the same situation as a slot that was never declared.
 * - `width` picks the slot's compact/regular override, since a launch screen
 *   on a tablet is the same surface at a different size.
 */
export function resolveLaunchArtwork(
  theme: ResolvedCustomTheme | null | undefined,
  assets: Record<string, string> | undefined,
  mode: 'light' | 'dark',
  width: 'compact' | 'regular' = 'compact'
): LaunchArtwork {
  if (!theme || !assets) return { kind: 'default' };

  const illustration = resolveThemeImage(
    theme.manifest,
    'emptyState.illustration',
    mode,
    width,
    true
  );
  const illustrationUri = illustration ? ownedAsset(assets, illustration.asset) : undefined;
  if (illustrationUri) return { kind: 'illustration', uri: illustrationUri };

  const logo = resolveHomeIdentity(theme.manifest).logo;
  const logoUri = logo?.mode === 'custom' ? ownedAsset(assets, logo.asset) : undefined;
  if (logoUri) return { kind: 'logo', uri: logoUri };

  return { kind: 'default' };
}

/**
 * The paper a launch surface stands on, or null to keep the app's own.
 *
 * Null rather than a colour for the no-pack case on purpose: the bundled floor
 * is the native splash's colour, which follows the system scheme and nothing
 * else, and only the caller knows that. A pack, having replaced the picture,
 * replaces the ground under it too -- otherwise a dark theme's illustration
 * arrives on the app's cream paper for the length of the handover.
 */
export function resolveLaunchBackground(
  theme: ResolvedCustomTheme | null | undefined,
  mode: 'light' | 'dark'
): string | null {
  if (!theme) return null;
  return theme[mode].colors.background;
}

function ownedAsset(assets: Record<string, string>, id: string): string | undefined {
  const uri = assets[id];
  return uri?.startsWith('file:///') ? uri : undefined;
}
