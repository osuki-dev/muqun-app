import { describe, expect, test } from 'bun:test';

import {
  BLOOM_OVERSHOOT,
  canSkipLaunchIntro,
  LAUNCH_INTRO_BUDGET_MS,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  WORLD_ARRIVAL_ZOOM,
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
    expect(beats.totalMs).toBe(1300);
  });

  test('even a front that stalls for the whole cap cannot pass the budget', () => {
    // The front waits, breathing around the hero, for the pack's wallpaper to
    // decode. That wait is the one thing here that depends on a disk read
    // rather than on a clock, so the cap is what keeps the budget a promise
    // rather than a hope -- and the worst case is the budget exactly.
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.bloomStallCapMs).toBeGreaterThan(0);
    expect(beats.totalMs + beats.bloomStallCapMs).toBe(LAUNCH_INTRO_BUDGET_MS);
  });

  test('the deadline for giving up on Skia is the end of the stall', () => {
    // A front that has run out of patience has to take off with something
    // behind it, so the moment it stops waiting is the moment the reveal is
    // chosen. Two numbers here would be two numbers that could disagree.
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.worldDeadlineAt).toBe(beats.bloom.at + beats.bloomStallCapMs);
    expect(beats.worldDeadlineAt).toBeLessThan(beats.holdUntil);
  });

  test('every moving beat has finished before the opening hands back', () => {
    const beats = launchIntroTimeline(DURATIONS);
    for (const beat of [beats.ignite, beats.bloom, beats.settle, beats.hero, beats.type]) {
      expect(beat.at + beat.ms).toBeLessThanOrEqual(beats.holdUntil);
    }
  });

  test('the beats overlap, so the launch resolves at once rather than in a list', () => {
    const beats = launchIntroTimeline(DURATIONS);
    // The rim is still closing as the front leaves it.
    expect(beats.bloom.at).toBeLessThanOrEqual(beats.ignite.at + beats.ignite.ms);
    // The hero is already lifting while the front is still crossing.
    expect(beats.hero.at).toBeLessThan(beats.bloom.at + beats.bloom.ms);
    // And the prompt starts typing before the hero has landed.
    expect(beats.type.at).toBeLessThan(beats.hero.at + beats.hero.ms);
  });

  test('the world settles for longer than it takes to arrive', () => {
    // The zoom is the slowest thing on screen on purpose: a world that stops
    // moving the instant it has finished arriving has no weight.
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.settle.ms).toBeGreaterThan(beats.bloom.ms);
    expect(WORLD_ARRIVAL_ZOOM).toBeGreaterThan(1);
    expect(WORLD_ARRIVAL_ZOOM).toBeLessThanOrEqual(1.08);
  });

  test('the cursor blinks only after the name is spelled out', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.blink.at).toBe(beats.type.at + beats.type.ms);
    expect(beats.holdUntil).toBe(beats.blink.at + beats.blink.ms);
  });

  test('the exit begins where the hold ends and is the last thing that happens', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.exit.at).toBe(beats.holdUntil);
    expect(beats.exit.at + beats.exit.ms).toBe(beats.totalMs);
  });

  test('the skip arms partway in, so an early tap is a reach rather than a refusal', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.skipArmedAt).toBeGreaterThan(0);
    expect(beats.skipArmedAt).toBeLessThan(beats.holdUntil);
    expect(beats.skipArmedAt).toBe(400);
  });

  test('the opening is stated in tokens, so retuning the scale retunes the launch', () => {
    const doubled = launchIntroTimeline({ micro: 300, short: 400, medium: 600, long: 800 });
    expect(doubled.totalMs).toBe(2600);
    expect(doubled.skipArmedAt).toBe(800);
  });

  test('the front overshoots the far corner, because its edge is ragged', () => {
    // A front that stops exactly at the corner leaves the corner ragged on the
    // frame it was supposed to have finished on.
    expect(BLOOM_OVERSHOOT).toBeGreaterThan(1);
  });
});

describe('reducedLaunchIntroTimeline', () => {
  test('nothing blooms, travels or types', () => {
    const beats = reducedLaunchIntroTimeline(DURATIONS);
    for (const beat of [
      beats.ignite,
      beats.bloom,
      beats.settle,
      beats.hero,
      beats.type,
      beats.blink,
    ]) {
      expect(beat).toEqual({ at: 0, ms: 0 });
    }
    expect(beats.bloomStallCapMs).toBe(0);
  });

  test('the cross-fade is kept, because opacity is not travel', () => {
    const beats = reducedLaunchIntroTimeline(DURATIONS);
    expect(beats.exit.ms).toBe(DURATIONS.short);
    expect(beats.totalMs).toBe(400);
    expect(beats.totalMs).toBeLessThan(launchIntroTimeline(DURATIONS).totalMs);
  });
});

describe('canSkipLaunchIntro', () => {
  const beats = launchIntroTimeline(DURATIONS);

  test('a tap before the gate is the reader reaching for the app', () => {
    expect(canSkipLaunchIntro(0, beats)).toBe(false);
    expect(canSkipLaunchIntro(399, beats)).toBe(false);
  });

  test('a tap after it ends the opening', () => {
    expect(canSkipLaunchIntro(400, beats)).toBe(true);
    expect(canSkipLaunchIntro(401, beats)).toBe(true);
    expect(canSkipLaunchIntro(100_000, beats)).toBe(true);
  });

  test('with Reduce Motion there is nothing to sit through', () => {
    expect(canSkipLaunchIntro(0, reducedLaunchIntroTimeline(DURATIONS))).toBe(true);
  });

  test('a clock that has gone strange cannot arm the skip', () => {
    expect(canSkipLaunchIntro(Number.NaN, beats)).toBe(false);
    expect(canSkipLaunchIntro(Number.POSITIVE_INFINITY, beats)).toBe(false);
  });
});
