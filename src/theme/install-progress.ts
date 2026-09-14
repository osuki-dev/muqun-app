import type { ThemeAssetProgress } from '@/theme/asset-stream';

/**
 * Where an install has got to, as one value with three phases.
 *
 * Installing a published theme is three different waits wearing one spinner:
 * the package comes down, it is inflated and checksummed, and then its images
 * are hashed, written and decoded one at a time. They have different lengths,
 * different failure modes and different things to count, and a single
 * "Installing…" over all three is why the middle one read as a freeze.
 *
 * So each phase says its own name and counts its own units. `downloading` has
 * nothing to count -- the transport resolves one `Uint8Array` and there is no
 * streaming callback to ask -- so it is honestly indeterminate rather than a
 * bar stuck at zero. `unpacking` counts ZIP entries, of which an archive has at
 * most 34. `assets` counts images.
 *
 * Progress is monotonic *within* a phase and resets at each boundary, which is
 * the one place the bar is allowed to go backwards -- and it does it while
 * invisible, between the bar's own fade out and fade in. See
 * `theme-import-progress.tsx`.
 */
export type ThemeInstallProgress =
  | { phase: 'downloading' }
  | { phase: 'unpacking'; completed: number; total: number }
  | { phase: 'assets'; completed: number; total: number; receivedBytes: number };

/**
 * The asset stream's own progress, at this boundary.
 *
 * `stageThemeAssetStream` keeps reporting exactly what it reports today --
 * `ThemeAssetProgress`, with its own `'staging' | 'ready'` shape and its own
 * field names -- because it is a producer with four consumers and renaming its
 * vocabulary to suit one screen would be the tail wagging the dog. The rename
 * happens here instead, once, where the two models meet: `'ready'` is not a
 * phase of its own but the end of this one, and the counts lose the `Assets`
 * suffix they only ever had to disambiguate themselves from nothing.
 */
export function assetInstallProgress(progress: ThemeAssetProgress): ThemeInstallProgress {
  return {
    phase: 'assets',
    completed: progress.completedAssets,
    total: progress.totalAssets,
    receivedBytes: progress.receivedBytes,
  };
}
