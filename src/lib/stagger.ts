/**
 * The delay of one item in a sequence that arrives together.
 *
 * Pure, and outside `motion.ts`, because that module pulls in Reanimated and
 * so cannot be loaded by `bun test`; this is the part with arithmetic in it.
 *
 * `step` is the beat the sequence would like between neighbours. `budgetMs` is
 * the time by which the *last* item has to have finished arriving, its own
 * `durationMs` included, so a list that grows a row compresses its beat rather
 * than taking longer to settle. Indexes past the end are held at the last slot,
 * and a sequence with no room left in the budget arrives all at once.
 */
export function staggerDelay(
  index: number,
  count: number,
  step: number,
  durationMs: number,
  budgetMs: number
): number {
  if (index <= 0 || count <= 1) return 0;
  const room = Math.max(0, budgetMs - durationMs);
  const beat = Math.min(step, room / (count - 1));
  return Math.round(Math.min(index, count - 1) * beat);
}
