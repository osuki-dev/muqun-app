/**
 * The Stage session strip's billboard flip: which way the slats turn and when
 * each one starts. Pure, so the arithmetic is tested; the animation itself
 * lives in `src/components/home-stage/stage-session-strip.tsx` and its timings
 * in `STAGE_FLIP_MOTION` (`src/lib/motion.ts`).
 */
import { wrapStageIndex } from '@/lib/home-stage-geometry';
import { staggerDelay } from '@/lib/stagger';

/** +1 when the selection moved to the next computer, -1 to the previous one. */
export type StageFlipDirection = 1 | -1;

/**
 * The way the cover-flow travelled from `from` to `to` among `count`
 * computers. The cover-flow wraps, so the shorter way round wins; with two
 * computers both ways are one step and the index order decides.
 */
export function stageFlipDirection(from: number, to: number, count: number): StageFlipDirection {
  if (count <= 2 || from < 0 || to < 0) return to < from ? -1 : 1;
  const forward = wrapStageIndex(to - from, count);
  return forward <= count / 2 ? 1 : -1;
}

/** How many cards of the strip are on screen at its start, partly shown ones included. */
export function stageFlipVisibleSlots(
  viewWidth: number,
  cardWidth: number,
  gap: number,
  padding: number
): number {
  if (!(viewWidth > 0) || !(cardWidth > 0)) return 1;
  return Math.max(1, Math.ceil((viewWidth - padding) / (cardWidth + Math.max(0, gap))));
}

/**
 * When the slat at `index` starts turning. Left to right on `stepMs`, only the
 * cards on screen take part (the ones past the edge turn with the last visible
 * one), and the beat compresses so the last slat has landed inside `budgetMs`.
 */
export function stageFlipDelay(
  index: number,
  visibleSlots: number,
  stepMs: number,
  cardMs: number,
  budgetMs: number
): number {
  return staggerDelay(index, visibleSlots, stepMs, cardMs, budgetMs);
}
