export type PickedThemeArtwork = { uri: string; dispose: () => void };

/** The captured theme owns the result, even if the native picker outlives its page. */
export async function commitThemeArtworkSelection(options: {
  pick: () => Promise<PickedThemeArtwork | null>;
  isCurrent: () => boolean;
  /** True retains a draft's reservation; durable writes can release it immediately. */
  commit: (artwork: PickedThemeArtwork) => boolean;
}): Promise<void> {
  const artwork = await options.pick();
  if (!artwork) return;
  let retained = false;
  try {
    if (options.isCurrent()) retained = options.commit(artwork);
  } finally {
    if (!retained) artwork.dispose();
  }
}
