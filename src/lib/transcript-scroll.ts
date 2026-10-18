/**
 * Where the reader is in the transcript, and whether anything has arrived
 * under them.
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
 * Browsing history always needs a way back, even in an idle conversation.
 * Pending output also keeps the action available until it has been read.
 */
export function showJumpToLatest(atBottom: boolean, unseenRows: number): boolean {
  return !atBottom || unseenRows > 0;
}

/**
 * What the transcript looked like when the reader was last level with its end.
 *
 * Two numbers rather than one, because a row *arriving* and a row *growing*
 * are both content landing under the reader, and only the first of them
 * changes a row count. An assistant answer streams into a single row: its
 * `seq` climbs word by word while the length of the transcript stands still,
 * so a count of rows left the way back hidden for the whole of a long answer
 * -- most visibly for a reader at the very top, where every word of it is out
 * of sight.
 */
export interface TranscriptMark {
  /** How many rows the transcript has. */
  rows: number;
  /** The highest sequence any of them has taken. */
  seq: number;
}

/** Nothing read yet: the mark a transcript starts from. */
export const TRANSCRIPT_START: TranscriptMark = Object.freeze({ rows: 0, seq: 0 });

/**
 * How much has landed under the reader since they were last at the end.
 *
 * Rows when there are new rows to count, and otherwise one -- a row that has
 * grown is one thing to go and see, whatever number of words it grew by.
 */
export function unseenBelow(seen: TranscriptMark, current: TranscriptMark): number {
  if (current.rows > seen.rows) return current.rows - seen.rows;
  return current.seq > seen.seq ? 1 : 0;
}
