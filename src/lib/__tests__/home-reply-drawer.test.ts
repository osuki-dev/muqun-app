import { describe, expect, test } from 'bun:test';
import {
  REPLY_DRAWER_MIN_HEIGHT,
  replyDrawerHeights,
  replyDrawerRubberBand,
  replyDrawerSettle,
} from '../home-reply-drawer';

const heights = { peek: 400, full: 700 };

describe('replyDrawerHeights', () => {
  test('peek reaches 65% of the window; full stops under the status bar', () => {
    expect(replyDrawerHeights({ windowHeight: 800, topInset: 40, field: 100 })).toEqual({
      peek: 520,
      full: 752,
    });
  });

  test('a short window keeps the minimum above the field, and peek never exceeds full', () => {
    const short = replyDrawerHeights({ windowHeight: 400, topInset: 40, field: 300 });
    expect(short.peek).toBe(300 + REPLY_DRAWER_MIN_HEIGHT);
    expect(short.full).toBe(300 + REPLY_DRAWER_MIN_HEIGHT);
    const tall = replyDrawerHeights({ windowHeight: 1000, topInset: 400, field: 0 });
    expect(tall.peek).toBeLessThanOrEqual(tall.full);
  });
});

describe('replyDrawerSettle', () => {
  test('a slow release rests at the nearest snap', () => {
    expect(replyDrawerSettle({ height: 380, velocityY: 0, heights })).toBe('peek');
    expect(replyDrawerSettle({ height: 620, velocityY: 0, heights })).toBe('full');
    expect(replyDrawerSettle({ height: 120, velocityY: 0, heights })).toBe('closed');
  });

  test('a flick moves one snap in its direction, never two', () => {
    expect(replyDrawerSettle({ height: 410, velocityY: -1500, heights })).toBe('full');
    expect(replyDrawerSettle({ height: 20, velocityY: -1500, heights })).toBe('peek');
    expect(replyDrawerSettle({ height: 690, velocityY: 1500, heights })).toBe('peek');
    expect(replyDrawerSettle({ height: 390, velocityY: 1500, heights })).toBe('closed');
  });

  test('a throw past the top or bottom stays at the end snaps', () => {
    expect(replyDrawerSettle({ height: 720, velocityY: -1500, heights })).toBe('full');
    expect(replyDrawerSettle({ height: 0, velocityY: 1500, heights })).toBe('closed');
  });

  test('a moderate throw is projected before choosing', () => {
    // 500 alone is nearer peek; carried upward at 600pt/s it lands nearer full.
    expect(replyDrawerSettle({ height: 520, velocityY: -600, heights })).toBe('full');
    expect(replyDrawerSettle({ height: 520, velocityY: 0, heights })).toBe('peek');
  });
});

describe('replyDrawerRubberBand', () => {
  test('follows the finger below full and resists past it', () => {
    expect(replyDrawerRubberBand(300, 700)).toBe(300);
    expect(replyDrawerRubberBand(-20, 700)).toBe(0);
    const pulled = replyDrawerRubberBand(800, 700);
    expect(pulled).toBeGreaterThan(700);
    expect(pulled).toBeLessThan(760);
  });
});
