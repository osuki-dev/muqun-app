/**
 * When each beat of the launch boot sequence starts, and how long it runs.
 *
 * Kept apart from the component, and free of every React Native import, for
 * two reasons. The first is that this is the part with a right answer: a
 * launch animation is a promise that the app is nearly ready, and one that
 * outstays the app it covers is a worse launch than no animation at all. The
 * budget below is that promise, and `bun test` holds us to it.
 *
 * The second is mechanical: anything that reaches Reanimated cannot be
 * imported by a bun test at all (see the note atop `motion-tokens.test.ts`),
 * so a timeline expressed inside the component is a timeline nobody can
 * assert on. Taking the four design-system durations as an argument rather
 * than importing them keeps this module loadable in a test while the values
 * themselves still come from one place at the call site.
 *
 * Every beat is stated in those durations rather than in numbers of its own,
 * so a global tuning pass over `motion.ts` retunes the launch along with
 * everything else -- which is the whole point of having a token scale.
 */

/** The four durations from `@/lib/motion`'s `DURATION`, passed in rather than imported. */
export type MotionDurations = {
  micro: number;
  short: number;
  medium: number;
  long: number;
};

/** A beat: when it starts relative to the handover, and how long it takes. */
export type IntroBeat = {
  /** Offset from the native handover, in ms. */
  at: number;
  /** How long the beat runs, in ms. */
  ms: number;
};

export type LaunchIntroTimeline = {
  /** The displaced copies of the picture collapsing back onto it: signal lock. */
  lock: IntroBeat;
  /** One pass of the scan band down the picture. One -- never a loop. */
  scan: IntroBeat;
  /** The four corner brackets closing on the picture's box. */
  frame: IntroBeat;
  /** Before this, a tap is the reader reaching for the app, not skipping the intro. */
  skipArmedAt: number;
  /** When the sequence stops asking for attention and hands back. */
  holdUntil: number;
  /** The cross-fade into the app's first frame. */
  exit: IntroBeat;
  /** Handover to fully hidden. */
  totalMs: number;
};

/**
 * The ceiling, in ms, on everything between the native handover and the app.
 *
 * Not a target -- a limit. A cold start has already spent time the reader did
 * not choose to spend, and the intro is spending more of it.
 */
export const LAUNCH_INTRO_BUDGET_MS = 1600;

/**
 * The full sequence: lock, one scan pass, the frame closing, a hold, an exit.
 *
 * The beats overlap on purpose. Three things that each wait their turn read as
 * a list being recited; three that start while the one before is still moving
 * read as one event. `scan` opens while `lock` is still converging and `frame`
 * lands as `scan` clears the picture, so the whole thing resolves at once
 * rather than counting itself out.
 */
export function launchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const holdUntil = d.long + d.long + d.short;
  return {
    lock: { at: 0, ms: d.short },
    scan: { at: d.micro, ms: d.long },
    frame: { at: d.medium, ms: d.short },
    skipArmedAt: d.long,
    holdUntil,
    exit: { at: holdUntil, ms: d.long },
    totalMs: holdUntil + d.long,
  };
}

/**
 * The same launch with Reduce Motion on: nothing travels, nothing sweeps,
 * nothing scales.
 *
 * The sheet holds for one short beat -- long enough that the app's first frame
 * is composed behind it rather than snapping in -- and then cross-fades. The
 * cross-fade is kept deliberately. Opacity is not travel, and a dissolve is
 * what the setting asks for *in place of* movement, not something it asks us
 * to remove as well; cutting straight to the app would be a hard cut, which is
 * a worse answer to "reduce motion" than a short fade.
 *
 * `skipArmedAt` is 0 because there is nothing left to sit through.
 */
export function reducedLaunchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const still: IntroBeat = { at: 0, ms: 0 };
  return {
    lock: still,
    scan: still,
    frame: still,
    skipArmedAt: 0,
    holdUntil: d.short,
    exit: { at: d.short, ms: d.short },
    totalMs: d.short + d.short,
  };
}

/**
 * Whether a tap this far into the sequence should end it.
 *
 * Takes the elapsed time rather than reading a clock itself, so the rule is
 * one comparison a test can state outright, and so a process that was paused
 * and restored cannot arm the skip by the calendar.
 */
export function canSkipLaunchIntro(elapsedMs: number, timeline: LaunchIntroTimeline): boolean {
  if (!Number.isFinite(elapsedMs)) return false;
  return elapsedMs >= timeline.skipArmedAt;
}
