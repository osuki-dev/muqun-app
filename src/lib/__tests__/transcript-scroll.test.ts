import { describe, expect, test } from 'bun:test';

import {
  NEAR_BOTTOM_PX,
  distanceFromBottom,
  isAtBottom,
  showJumpToLatest,
  TRANSCRIPT_START,
  unseenBelow,
} from '../transcript-scroll';

const tall = { offset: 0, viewport: 800, content: 5000 };

describe('distanceFromBottom', () => {
  test('is zero at the end', () => {
    expect(distanceFromBottom({ ...tall, offset: 4200 })).toBe(0);
  });

  test('grows as the reader scrolls up', () => {
    expect(distanceFromBottom({ ...tall, offset: 3200 })).toBe(1000);
    expect(distanceFromBottom(tall)).toBe(4200);
  });

  test('never goes negative through overscroll', () => {
    expect(distanceFromBottom({ ...tall, offset: 4600 })).toBe(0);
  });
});

describe('isAtBottom', () => {
  test('a reader at the end is at the end', () => {
    expect(isAtBottom({ ...tall, offset: 4200 })).toBe(true);
  });

  test('and so is one within the threshold', () => {
    expect(isAtBottom({ ...tall, offset: 4200 - NEAR_BOTTOM_PX })).toBe(true);
  });

  test('a reader a screen up is not', () => {
    // The old arithmetic answered `true` here, which is why the way back was
    // never offered.
    expect(isAtBottom({ ...tall, offset: 2000 })).toBe(false);
  });

  test('an empty transcript is at its end', () => {
    expect(isAtBottom({ offset: 0, viewport: 800, content: 0 })).toBe(true);
  });
});

describe('unseenBelow', () => {
  test('nothing when the transcript has not moved', () => {
    expect(unseenBelow({ rows: 10, seq: 40 }, { rows: 10, seq: 40 })).toBe(0);
  });

  test('nothing from the start mark of an empty transcript', () => {
    expect(unseenBelow(TRANSCRIPT_START, { rows: 0, seq: 0 })).toBe(0);
  });
});

describe('showJumpToLatest', () => {
  test('offers a return from history with or without unread output', () => {
    expect(showJumpToLatest(false, 0)).toBe(true);
    expect(showJumpToLatest(false, 3)).toBe(true);
  });

  test('hides at the latest message only when no unread output remains', () => {
    expect(showJumpToLatest(true, 0)).toBe(false);
    expect(showJumpToLatest(true, 1)).toBe(true);
  });
});
