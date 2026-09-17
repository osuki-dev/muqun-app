/**
 * Where the reader is in the transcript, and whether anything has arrived
 * under them.
 *
 * Two facts, both of which the workbench got wrong. The distance from the
 * bottom was computed with its terms the wrong way round --
 * `offset + viewport - content`, which is zero at the bottom and *negative*
 * everywhere above it, so "less than 120" was true no matter how far up the
 * reader had scrolled and the jump-to-latest affordance never appeared. And
 * the affordance, once it did appear, said nothing about whether there was
 * anything new to jump to.
 *
 * Pure, so the arithmetic is stated once and tested once.
 */

/** How close to the end still counts as being at the end. */
export const NEAR_BOTTOM_PX = 120;

export interface ScrollGeometry {
  /** How far the content has been scrolled. */
  offset: number;
  /** The height of the window onto it. */
  viewport: number;
  /** The height of the content itself. */
  content: number;
}

/** Pixels of content below the bottom edge of the viewport; never negative. */
export function distanceFromBottom({ offset, viewport, content }: ScrollGeometry): number {
  return Math.max(0, content - (offset + viewport));
}

/** Whether the reader is at the end, within the threshold. */
export function isAtBottom(geometry: ScrollGeometry, threshold = NEAR_BOTTOM_PX): boolean {
  if (geometry.content <= 0) return true;
  return distanceFromBottom(geometry) <= threshold;
}

/**
 * Whether to offer the way back to the newest row.
 *
 * Only to a reader who has left the end *and* has something waiting there:
 * scrolling up to read something is not by itself a reason to put a button
 * over the transcript.
 */
export function showJumpToLatest(atBottom: boolean, unseenRows: number): boolean {
  return !atBottom && unseenRows > 0;
}
