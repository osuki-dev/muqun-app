import { expect, test } from 'bun:test';

import { holdFor, remainingVisibleMs } from '../minimum-visible';

// 180ms stands in for `DURATION.short` here: `motion.ts` imports Reanimated and
// will not load outside Metro, and the arithmetic is the same whatever the
// token resolves to. The call site passes the token.
const SHORT = 180;

test('a state that has only just gone up owes its whole welcome', () => {
  expect(remainingVisibleMs(1_000, SHORT, 1_000)).toBe(SHORT);
});

test('a state part-way through owes the rest of it', () => {
  expect(remainingVisibleMs(1_000, SHORT, 1_050)).toBe(SHORT - 50);
});

test('a state that has had its time owes nothing, and never a negative wait', () => {
  expect(remainingVisibleMs(1_000, SHORT, 1_000 + SHORT)).toBe(0);
  expect(remainingVisibleMs(1_000, SHORT, 9_000)).toBe(0);
});

test('a clock that moved under us waits the whole floor rather than none of it', () => {
  // A manual change or a timezone database update must not be read as "this
  // has been up for a week". The cost of being wrong this way is one short
  // beat; the cost of being wrong the other way is the state never being seen.
  expect(remainingVisibleMs(9_000, SHORT, 1_000)).toBe(SHORT);
});

test('a floor that is not a duration is not a floor', () => {
  expect(remainingVisibleMs(1_000, 0, 1_000)).toBe(0);
  expect(remainingVisibleMs(1_000, -5, 1_000)).toBe(0);
  expect(remainingVisibleMs(Number.NaN, SHORT, 1_000)).toBe(0);
  expect(remainingVisibleMs(1_000, Number.NaN, 1_000)).toBe(0);
});

test('holding for nothing resolves without waiting for a timer', async () => {
  // The success path calls this with whatever `remainingVisibleMs` returned,
  // which is usually zero on a slow connection: it must not cost a tick then.
  const before = Date.now();
  await holdFor(0);
  await holdFor(-1);
  expect(Date.now() - before).toBeLessThan(SHORT);
});

test('holding for a duration actually hands the frame back', async () => {
  const before = Date.now();
  await holdFor(20);
  expect(Date.now() - before).toBeGreaterThanOrEqual(15);
});
