/**
 * Keeping the reader's place when earlier output is prepended (card #619).
 *
 * The agent text view loads history by re-reading the pane with a larger line
 * limit, so the whole transcript is replaced and the lines that were on screen
 * move *down* by however much was added above them. Without a correction the
 * reader is left staring at output they had already read, several screens away
 * from where they pulled.
 *
 * The terminal view solves the same problem on row signatures, which a reflowed
 * markdown document does not have. What it does have is a content height, and
 * prepending is the only thing that changed it, so the growth is the distance
 * everything moved.
 */

export type TranscriptScrollPosition = {
  /** Content height measured before the earlier page was requested. */
  contentHeight: number;
  /** Scroll offset at that moment. */
  offset: number;
};

/**
 * The offset that puts the line the reader was looking at back where it was, or
 * `null` when the transcript did not grow and nothing needs moving.
 *
 * A `null` answer is the honest one for a load that returned no earlier output:
 * scrolling to a computed position anyway would jerk the view for no reason.
 */
export function anchorAfterEarlierOutput(
  before: TranscriptScrollPosition,
  nextContentHeight: number
): number | null {
  if (!Number.isFinite(nextContentHeight) || !Number.isFinite(before.contentHeight)) return null;
  if (!Number.isFinite(before.offset)) return null;

  const growth = nextContentHeight - before.contentHeight;
  // A shrunken transcript means the window moved rather than grew -- an
  // unrelated refresh landing mid-load. Leave the view where the reader put it.
  if (growth <= 0) return null;

  return Math.max(0, before.offset + growth);
}
