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

describe('showJumpToLatest', () => {
  test('offered when rows arrived behind the reader', () => {
    expect(showJumpToLatest(false, 3)).toBe(true);
  });

  test('not while they are already at the end', () => {
    expect(showJumpToLatest(true, 3)).toBe(false);
  });

  test('not for merely having scrolled up', () => {
    expect(showJumpToLatest(false, 0)).toBe(false);
  });
});

describe('unseenBelow', () => {
  test('counts the rows that arrived', () => {
    expect(unseenBelow({ rows: 10, seq: 40 }, { rows: 13, seq: 43 })).toBe(3);
  });

  test('counts a row that only grew as one thing to see', () => {
    // A streaming answer: one row, a sequence climbing word by word. This is
    // the case a row count answered `0` for, which left the way back hidden
    // for a reader parked at the very top of a long transcript.
    expect(unseenBelow({ rows: 10, seq: 40 }, { rows: 10, seq: 41 })).toBe(1);
  });

  test('nothing when the transcript has not moved', () => {
    expect(unseenBelow({ rows: 10, seq: 40 }, { rows: 10, seq: 40 })).toBe(0);
  });

  test('nothing from the start mark of an empty transcript', () => {
    expect(unseenBelow(TRANSCRIPT_START, { rows: 0, seq: 0 })).toBe(0);
  });

  test('drives the pill for a reader at the very top', () => {
    const seen = { rows: 200, seq: 900 };
    const streaming = { rows: 200, seq: 901 };
    expect(showJumpToLatest(false, unseenBelow(seen, streaming))).toBe(true);
  });
});
