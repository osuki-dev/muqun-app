import { describe, expect, test } from 'bun:test';

import {
  canSkipLaunchIntro,
  LAUNCH_INTRO_BUDGET_MS,
  launchIntroTimeline,
  reducedLaunchIntroTimeline,
  type MotionDurations,
} from '../launch-intro-timeline';

// Pass a duration scale without loading Reanimated in the unit runner.
const DURATIONS: MotionDurations = { micro: 150, short: 200, medium: 300, long: 400 };

describe('launchIntroTimeline', () => {
  test('the whole opening fits inside the launch budget', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.totalMs).toBeLessThanOrEqual(LAUNCH_INTRO_BUDGET_MS);
  });

  test('the snap starts with the exit and only drifts past the budget over a live app', () => {
    // The overlay stops taking touches the moment it exits, so the snap's
    // extra 400 ms is drift over an app that already answers, not waiting.
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.snap.at).toBe(beats.exit.at);
    expect(beats.snap.at + beats.bloomStallCapMs).toBeLessThan(LAUNCH_INTRO_BUDGET_MS);
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

  test('the cursor blinks only after the name is spelled out', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.blink.at).toBe(beats.type.at + beats.type.ms);
    expect(beats.holdUntil).toBe(beats.blink.at + beats.blink.ms);
  });

  test('the exit begins where the hold ends and is the last thing that happens', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.exit.at).toBe(beats.holdUntil);
    expect(beats.exit.at + beats.exit.ms).toBe(beats.totalMs);
    expect(beats.snap.at + beats.snap.ms).toBeGreaterThan(beats.totalMs);
  });

  test('the skip arms partway in, so an early tap is a reach rather than a refusal', () => {
    const beats = launchIntroTimeline(DURATIONS);
    expect(beats.skipArmedAt).toBeGreaterThan(0);
    expect(beats.skipArmedAt).toBeLessThan(beats.holdUntil);
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
    expect(beats.snap).toEqual(beats.exit);
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
