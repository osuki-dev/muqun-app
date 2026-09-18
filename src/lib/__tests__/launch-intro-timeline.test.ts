import { describe, expect, test } from 'bun:test';

import {
  canSkipLaunchIntro,
  LAUNCH_INTRO_BUDGET_MS,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  WIPE_COVERED_AT,
  type MotionDurations,
} from '../launch-intro-timeline';

/**
 * The design system's scale, restated here rather than imported: `motion.ts`
 * reaches Reanimated and will not load in a bun test. `motion-tokens.test.ts`
 * is what keeps the app's own call site on the real tokens; what these tests
 * hold is the shape of the opening built out of them.
 */
const DURATIONS: MotionDurations = { micro: 150, short: 200, medium: 300, long: 400 };

describe('launchIntroTimeline', () => {
  test('the whole opening fits inside the launch budget', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.totalMs).toBeLessThanOrEqual(LAUNCH_INTRO_BUDGET_MS);
    // And the budget is a limit rather than a description: an opening that has
    // grown to exactly fill it has grown too far to notice it did.
    expect(beats.totalMs).toBe(1400);
  });

  test('every moving beat has finished before the opening hands back', () => {
    const beats = launchIntroTimeline(DURATIONS);
    for (const beat of [beats.wipe, beats.hero, beats.rise]) {
      expect(beat.at + beat.ms).toBeLessThanOrEqual(beats.holdUntil);
    }
  });

  test('the beats overlap, so the launch resolves at once rather than in a list', () => {
    const beats = launchIntroTimeline(DURATIONS);
    // The hero is already moving while the cut is still crossing, and the page
    // starts rising before the hero has landed.
    expect(beats.hero.at).toBeLessThan(beats.wipe.at + beats.wipe.ms);
    expect(beats.rise.at).toBeLessThan(beats.hero.at + beats.hero.ms);
  });

  test('the cut is covering the screen while the hero is still on its way', () => {
    // The swap underneath happens on the covered frame, so the hero must not
    // have arrived before the cover exists -- otherwise the exchange is seen.
    const beats = launchIntroTimeline(DURATIONS);
    const coveredAt = beats.wipe.at + beats.wipe.ms * WIPE_COVERED_AT;
    expect(coveredAt).toBeLessThan(beats.hero.at + beats.hero.ms);
  });

  test('the exit begins exactly where the hold ends, and nothing follows it', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.exit.at).toBe(beats.holdUntil);
    expect(beats.exit.at + beats.exit.ms).toBe(beats.totalMs);
  });

  test('the skip arms while the opening is still running, not after it', () => {
    const beats = launchIntroTimeline(DURATIONS);
    // A skip that arms after the hold is not a skip; it is a formality.
    expect(beats.skipArmedAt).toBeGreaterThan(0);
    expect(beats.skipArmedAt).toBeLessThan(beats.holdUntil);
    expect(beats.skipArmedAt).toBe(400);
  });

  test('retuning the token scale retunes the launch with it', () => {
    // The point of stating the beats in tokens: nothing here carries a number
    // of its own that a global tuning pass would walk past.
    const doubled = launchIntroTimeline({ micro: 300, short: 400, medium: 600, long: 800 });
    expect(doubled.totalMs).toBe(2800);
    expect(doubled.skipArmedAt).toBe(800);
  });
});

describe('WIPE_COVERED_AT', () => {
  test('the swap frame is inside the cut, not at either end of it', () => {
    // At 0 the cut has not arrived and at 1 it has gone; either would exchange
    // the launch frame for the pack's world in plain sight.
    expect(WIPE_COVERED_AT).toBeGreaterThan(0);
    expect(WIPE_COVERED_AT).toBeLessThan(1);
  });
});

describe('reducedLaunchIntroTimeline', () => {
  test('nothing moves: every travelling beat is zero-length', () => {
    const beats = reducedLaunchIntroTimeline(DURATIONS);
    for (const beat of [beats.wipe, beats.hero, beats.rise]) {
      expect(beat).toEqual({ at: 0, ms: 0 });
    }
  });

  test('the cross-fade survives, because a hard cut is not the accessible answer', () => {
    const beats = reducedLaunchIntroTimeline(DURATIONS);
    expect(beats.exit.ms).toBeGreaterThan(0);
    expect(beats.exit.ms).toBe(DURATIONS.short);
  });

  test('it is far shorter than the full opening and still inside the budget', () => {
    const beats = reducedLaunchIntroTimeline(DURATIONS);
    expect(beats.totalMs).toBe(400);
    expect(beats.totalMs).toBeLessThan(launchIntroTimeline(DURATIONS).totalMs);
    expect(beats.totalMs).toBeLessThanOrEqual(LAUNCH_INTRO_BUDGET_MS);
  });
});

describe('canSkipLaunchIntro', () => {
  const beats = launchIntroTimeline(DURATIONS);

  test('a tap before the gate is the reader reaching for the app, and is ignored', () => {
    expect(canSkipLaunchIntro(0, beats)).toBe(false);
    expect(canSkipLaunchIntro(399, beats)).toBe(false);
  });

  test('the gate itself counts as armed', () => {
    expect(canSkipLaunchIntro(400, beats)).toBe(true);
  });

  test('a tap after the gate ends the opening', () => {
    expect(canSkipLaunchIntro(401, beats)).toBe(true);
    expect(canSkipLaunchIntro(100_000, beats)).toBe(true);
  });

  test('with Reduce Motion there is nothing to sit through, so it is armed at once', () => {
    expect(canSkipLaunchIntro(0, reducedLaunchIntroTimeline(DURATIONS))).toBe(true);
  });

  test('a clock that produced nonsense never arms the skip', () => {
    // The gate is fed `Date.now() - startedAt`. Nothing should be able to make
    // that non-finite, which is exactly why the guard is cheap to keep: a skip
    // that fires on a garbage reading eats the reader's first touch.
    expect(canSkipLaunchIntro(Number.NaN, beats)).toBe(false);
    expect(canSkipLaunchIntro(Number.POSITIVE_INFINITY, beats)).toBe(false);
  });
});
