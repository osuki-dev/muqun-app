import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { compileTheme, type ResolvedCustomTheme } from '@/theme/resolve';
import type { ThemeManifest } from '@/theme/schema';

/**
 * The custom theme a surface draws from, and the installed files it may use.
 *
 * Every artwork consumer needs the pair rather than the theme alone: a manifest
 * names an asset id and only the installation knows which app-owned file that
 * id resolved to. They travel together so a component cannot accidentally pair
 * one theme's manifest with another theme's images.
 */
export type EffectiveCustomTheme = {
  theme: ResolvedCustomTheme | null;
  assets: Record<string, string> | undefined;
};

/**
 * The installation id a theme wears while it is only being looked at.
 *
 * A candidate that is not installed has no identity of its own -- that is what
 * installing allocates -- but `ResolvedCustomTheme` carries one, and the
 * artwork consumers compare it against the library to find their files. This
 * value never matches an allocated id (those are 16 random bytes in hex), so a
 * preview can never be mistaken for an installation.
 */
export const CANDIDATE_INSTALLATION_ID = 'candidate';

/**
 * The pack a preview wears.
 *
 * An installed theme is resolved exactly the way the applied one is, through
 * `effectiveThemeManifest`: the author's values clamped to the readability
 * floor, with the reader's own opacity sliders and Home switches laid over the
 * top. That is what makes the sliders on this screen show their effect while
 * they are being dragged rather than only after the theme is applied.
 *
 * A theme that is not installed has no preferences to lay over anything, so it
 * gets the same call with an empty installation: the author's manifest, clamped
 * and nothing else. One code path rather than two, so the two cases cannot
 * drift into disagreeing about what a preview is.
 */
export function resolveCandidateTheme(
  manifest: ThemeManifest,
  assets: Record<string, string> = {},
  installed?: InstalledTheme
): ResolvedCustomTheme {
  const source: InstalledTheme = installed ?? { id: CANDIDATE_INSTALLATION_ID, manifest, assets };
  return compileTheme(effectiveThemeManifest(source), source.id);
}

/**
 * Which custom theme a component is drawing: the one being previewed, or the
 * one the app is wearing.
 *
 * The rule is the whole of the feature and it is deliberately this small. A
 * candidate is only ever supplied by the preview route, so everywhere else the
 * answer is the applied theme and the store read is the same one every consumer
 * did for itself before. Inside the preview, the candidate answers instead --
 * including when there is no applied theme at all, which is the case that used
 * to leave the preview route wearing the built-in pack.
 */
export function selectEffectiveCustomTheme(
  candidate: EffectiveCustomTheme | null,
  active: ResolvedCustomTheme | null,
  activeAssets: Record<string, string> | undefined
): EffectiveCustomTheme {
  return candidate ?? { theme: active, assets: activeAssets };
}
