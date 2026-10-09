import { describe, expect, test } from 'bun:test';

import { staggerDelay } from '@/lib/stagger';

describe('staggerDelay', () => {
  test('keeps the preferred beat while the sequence fits its budget', () => {
    // The Settings entry list: seven rows, a 32 ms beat, 200 ms rises, 400 ms.
    const delays = Array.from({ length: 7 }, (_, index) => staggerDelay(index, 7, 32, 200, 400));
    expect(delays).toEqual([0, 32, 64, 96, 128, 160, 192]);
    expect(delays[6] + 200).toBeLessThan(400);
  });

  test('compresses the beat so a longer list still lands inside the budget', () => {
    const last = staggerDelay(10, 11, 32, 200, 400);
    expect(last).toBe(200);
    expect(staggerDelay(5, 11, 32, 200, 400)).toBe(100);
  });

  test('the first item, a single item and a negative index start at once', () => {
    expect(staggerDelay(0, 7, 32, 200, 400)).toBe(0);
    expect(staggerDelay(3, 1, 32, 200, 400)).toBe(0);
    expect(staggerDelay(-1, 7, 32, 200, 400)).toBe(0);
  });

  test('an index past the end is held at the last slot', () => {
    expect(staggerDelay(12, 7, 32, 200, 400)).toBe(staggerDelay(6, 7, 32, 200, 400));
  });

  test('no room in the budget means no stagger', () => {
    expect(staggerDelay(4, 7, 32, 400, 400)).toBe(0);
    expect(staggerDelay(4, 7, 32, 500, 400)).toBe(0);
  });
});
