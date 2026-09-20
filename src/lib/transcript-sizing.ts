/**
 * How tall a transcript row actually is.
 *
 * Legend List 3 removed `getEstimatedItemSize`, so a list cannot be handed a
 * size per row kind any more; the migration note is explicit that
 * `estimatedItemSize` is now "a small initial allocation hint" and that after
 * the first measurement the list uses measured sizes and per-type averages of
 * its own. What it still needs is one number that is roughly right, because
 * that number decides how many item containers are allocated before anything
 * has been measured: too small and the list builds containers it will never
 * need, too large and it builds too few and creates more on demand mid-scroll
 * (which it warns about by name).
 *
 * The workbench had `estimatedItemSize={70}`. These are the sizes the list
 * itself measured, read back off `getState().getAverageItemSizes()` on a
 * 200-row session on the QA emulator after scrolling 104 rows through the
 * viewport:
 *
 *     assistant  180.9dp  (88 rows)
 *     user        81.0dp  (10 rows)
 *     system      68.5dp   (6 rows)
 *
 * The weighted average is 165dp. Using that as the allocation hint proved too
 * optimistic in live sessions: short rows exhausted the pool during scrolling.
 * Reserve for the measured user-row height instead. Spare containers do not
 * imply that the full contents of extra Markdown rows are rendered.
 *
 * The numbers are kept here rather than inline so the mix arithmetic is stated
 * once and tested once, and so the next person to re-measure has somewhere
 * obvious to put what they found.
 */

import type { TimelineRole } from './agent-protocol';

/**
 * Measured average height per row kind, in dp.
 *
 * Rounded to whole dp: the list treats this as a hint and nothing downstream
 * is more precise than a pixel.
 */
export const TRANSCRIPT_ROW_SIZE: Readonly<Record<TimelineRole, number>> = Object.freeze({
  assistant: 181,
  user: 81,
  system: 69,
});

/**
 * The mix as it was measured, used when a transcript has not been seen yet.
 *
 * An OpenCode transcript is mostly assistant output -- a turn is one prompt
 * and an answer that usually carries its tool calls folded into it -- and
 * weighting by that is much closer than averaging the three kinds evenly,
 * which would say 110dp for a list whose rows average 165dp.
 */
const MEASURED_MIX: Readonly<Record<TimelineRole, number>> = Object.freeze({
  assistant: 88,
  user: 10,
  system: 6,
});

/**
 * One allocation hint for a mix of row kinds.
 *
 * Returns the blend of the measured per-kind sizes weighted by how many rows
 * of each kind there are. An empty or unknown mix falls back to the mix that
 * was measured, so the value is never zero and never an unweighted mean.
 */
export function blendedRowSize(counts: Partial<Record<TimelineRole, number>>): number {
  let rows = 0;
  let total = 0;
  for (const role of ['assistant', 'user', 'system'] as const) {
    const count = counts[role] ?? 0;
    if (count <= 0) continue;
    rows += count;
    total += count * TRANSCRIPT_ROW_SIZE[role];
  }
  if (rows === 0) return blendedRowSize(MEASURED_MIX);
  return Math.round(total / rows);
}

/**
 * The container allocation hint, not an estimate of every message's height.
 *
 * A constant rather than a per-render count of the window: the value is read
 * once, when the list mounts and has nothing measured, and recomputing it on
 * every stream tick would be work spent on a number the list stops consulting
 * as soon as it has seen a row.
 */
export const TRANSCRIPT_ESTIMATED_ITEM_SIZE = TRANSCRIPT_ROW_SIZE.user;
