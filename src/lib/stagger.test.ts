import { describe, expect, test } from 'bun:test';

import { entryDelay, staggerDelay } from '@/lib/stagger';

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

describe('entryDelay', () => {
  // The Settings numbers: a 32 ms beat, 200 ms rises, a 400 ms budget.
  const at = (index: number, count: number, after = 0) =>
    entryDelay(index, count, after, 32, 200, 400);

  test('without an offset it is the stagger itself', () => {
    expect(at(3, 7)).toBe(staggerDelay(3, 7, 32, 200, 400));
  });

  test('the tail after seven rows still lands inside the budget', () => {
    const rowsSettled = staggerDelay(6, 7, 32, 200, 400);
    expect(rowsSettled).toBe(192);
    const tail = [0, 1].map((index) => at(index, 2, rowsSettled));
    expect(tail).toEqual([192, 200]);
    for (const delay of tail) expect(delay + 200).toBeLessThanOrEqual(400);
  });

  test('any offset is clamped to the latest start that still fits', () => {
    expect(at(2, 3, 192)).toBe(200);
    expect(at(0, 1, 10_000)).toBe(200);
    expect(entryDelay(0, 1, 50, 32, 500, 400)).toBe(0);
  });
});
