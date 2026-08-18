// Where the agent text view lands after earlier output is prepended (card #619).
//
// The gesture and the scroll view cannot be exercised here, so the arithmetic
// that decides the landing offset is kept out of the component: growth moves
// the reader down by exactly as much as was added above them, and a load that
// added nothing must not move them at all.
import { describe, expect, test } from 'bun:test';

import { anchorAfterEarlierOutput } from '../transcript-history-scroll';

describe('anchorAfterEarlierOutput', () => {
  test('moves down by exactly what was prepended', () => {
    expect(anchorAfterEarlierOutput({ contentHeight: 4000, offset: 120 }, 9000)).toBe(5120);
  });

  test('holds the very top of the transcript in place', () => {
    // Pulling from offset 0 is the common case: the added page lands above the
    // line that was under the thumb, so that line ends up one page down.
    expect(anchorAfterEarlierOutput({ contentHeight: 4000, offset: 0 }, 6400)).toBe(2400);
  });

  test('leaves the view alone when nothing was added', () => {
    expect(anchorAfterEarlierOutput({ contentHeight: 4000, offset: 120 }, 4000)).toBeNull();
  });

  test('leaves the view alone when the transcript shrank', () => {
    expect(anchorAfterEarlierOutput({ contentHeight: 4000, offset: 120 }, 3200)).toBeNull();
  });

  test('never returns a negative offset', () => {
    // A stale offset from a previous pane can be negative on iOS, where a
    // bounce reports past the top edge.
    expect(anchorAfterEarlierOutput({ contentHeight: 4000, offset: -60 }, 4020)).toBe(0);
  });

  test('ignores measurements that are not numbers', () => {
    expect(anchorAfterEarlierOutput({ contentHeight: Number.NaN, offset: 10 }, 5000)).toBeNull();
    expect(anchorAfterEarlierOutput({ contentHeight: 100, offset: Number.NaN }, 5000)).toBeNull();
    expect(anchorAfterEarlierOutput({ contentHeight: 100, offset: 10 }, Number.NaN)).toBeNull();
    expect(
      anchorAfterEarlierOutput({ contentHeight: 100, offset: 10 }, Number.POSITIVE_INFINITY)
    ).toBeNull();
  });
});
