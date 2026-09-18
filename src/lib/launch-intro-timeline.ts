/**
 * When each beat of the launch opening starts, and how long it runs.
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
  /**
   * The cut: one plane in the pack's primary crosses the screen, covers it,
   * and keeps going. The launch frame is behind it on the way in and the
   * pack's world is behind it on the way out.
   */
  wipe: IntroBeat;
  /**
   * How long the cut will wait, covered, for the pack's wallpaper to decode.
   *
   * A pack's background is a full-screen painting read off disk, and on a cold
   * start it is not ready in the quarter-second the cut takes to arrive. The
   * cut exists to hide an exchange, so if the thing being exchanged in is not
   * there yet the honest move is to stay covering rather than to clear onto
   * bare paper and let the world appear afterwards -- which is what the first
   * build of this did, and it read as the wallpaper popping in late.
   *
   * Capped, because a stall is a guess about a decode and the budget is a
   * promise. When it runs out the cut clears regardless.
   */
  wipeStallCapMs: number;
  /** The hero swelling to fill the stage and then settling into Home's hero rect. */
  hero: IntroBeat;
  /** The veil over Home's content dropping away, so the page rises under the picture. */
  rise: IntroBeat;
  /** Before this, a tap is the reader reaching for the app, not skipping the intro. */
  skipArmedAt: number;
  /** When the opening stops asking for attention and hands back. */
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
 * not choose to spend, and the opening is spending more of it.
 */
export const LAUNCH_INTRO_BUDGET_MS = 1600;

/**
 * The progress, within the wipe, at which the plane has the screen covered.
 *
 * What is underneath is exchanged on this frame -- the launch mirror out, the
 * pack's world in -- so it has to be a moment when nothing of either is
 * visible. Stated here rather than in the component because it is the one
 * number the swap and the plane have to agree on.
 */
export const WIPE_COVERED_AT = 0.45;

/**
 * The full opening: the cut, the hero settling, the page rising, a hold, an exit.
 *
 * The beats overlap on purpose. Three things that each wait their turn read as
 * a list being recited; three that start while the one before is still moving
 * read as one event. The hero is already swelling as the plane clears it, and
 * the page starts rising before the hero has landed, so the screen resolves at
 * once rather than counting itself out.
 */
export function launchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const holdUntil = d.long + d.long + d.short;
  return {
    wipe: { at: 0, ms: d.long + d.short },
    wipeStallCapMs: d.medium,
    hero: { at: d.medium, ms: d.long + d.short },
    rise: { at: d.long + d.short, ms: d.long },
    skipArmedAt: d.long,
    holdUntil,
    exit: { at: holdUntil, ms: d.medium },
    totalMs: holdUntil + d.medium,
  };
}

/**
 * The same launch with Reduce Motion on: nothing sweeps, nothing travels,
 * nothing scales.
 *
 * The pack's world and its hero are drawn where they finish, in Home's own
 * geometry, and the sheet holds for one short beat -- long enough that the
 * app's first frame is composed behind it rather than snapping in -- before
 * cross-fading. The cross-fade is kept deliberately. Opacity is not travel,
 * and a dissolve is what the setting asks for *in place of* movement, not
 * something it asks us to remove as well; cutting straight to the app would be
 * a hard cut, which is a worse answer to "reduce motion" than a short fade.
 *
 * `skipArmedAt` is 0 because there is nothing left to sit through.
 */
export function reducedLaunchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const still: IntroBeat = { at: 0, ms: 0 };
  return {
    wipe: still,
    wipeStallCapMs: 0,
    hero: still,
    rise: still,
    skipArmedAt: 0,
    holdUntil: d.short,
    exit: { at: d.short, ms: d.short },
    totalMs: d.short + d.short,
  };
}

/**
 * Whether a tap this far into the opening should end it.
 *
 * Takes the elapsed time rather than reading a clock itself, so the rule is
 * one comparison a test can state outright, and so a process that was paused
 * and restored cannot arm the skip by the calendar.
 */
export function canSkipLaunchIntro(elapsedMs: number, timeline: LaunchIntroTimeline): boolean {
  if (!Number.isFinite(elapsedMs)) return false;
  return elapsedMs >= timeline.skipArmedAt;
}
