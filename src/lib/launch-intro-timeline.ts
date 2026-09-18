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
   * The rim waking: a thin line in the pack's `primary` closing around the
   * hero, which is the only thing on screen when the OS hands over.
   *
   * It exists so that the first thing that moves is attached to the picture.
   * Everything after it grows out of this ring, so the reveal has somewhere
   * to have come from.
   */
  ignite: IntroBeat;
  /** The reveal front travelling from the hero's centre to past the far corner. */
  bloom: IntroBeat;
  /**
   * How long the front will idle around the hero, breathing, while the pack's
   * painting decodes.
   *
   * A pack's background is a full-screen painting read off disk, and on a cold
   * start it is not ready in the sixth of a second the rim takes to close. The
   * front waits rather than sweeping across nothing -- but it waits *visibly*,
   * as a ring that keeps breathing around the picture, because a launch that
   * stops moving reads as a launch that has hung.
   *
   * Capped, because a stall is a guess about a decode and the budget is a
   * promise. {@link LaunchIntroTimeline.worldDeadlineAt} is when it runs out.
   */
  bloomStallCapMs: number;
  /**
   * The moment the opening stops waiting for Skia and takes whichever world it
   * can get -- the Reanimated iris over an ordinary image, or the pack's
   * palette field.
   *
   * Derived rather than chosen: it is exactly the end of the stall, because a
   * front that has run out of patience has to take off with *something* behind
   * it, and the only question left is which something.
   */
  worldDeadlineAt: number;
  /** The wallpaper easing back from a touch zoomed to its own scale. */
  settle: IntroBeat;
  /** The hero lifting out of the launch frame and landing in Home's hero rect. */
  hero: IntroBeat;
  /** The prompt in the lower third typing the pack's name, one character at a time. */
  type: IntroBeat;
  /** The block cursor's single blink, once the name is spelled out. */
  blink: IntroBeat;
  /** Before this, a tap is the reader reaching for the app, not skipping the intro. */
  skipArmedAt: number;
  /** When the opening stops asking for attention and hands back. */
  holdUntil: number;
  /**
   * The cross-fade into the app's first frame, during which the prompt line
   * dissolves and Home's first card rises through where it was.
   */
  exit: IntroBeat;
  /** Handover to fully hidden. */
  totalMs: number;
};

/**
 * The ceiling, in ms, on everything between the native handover and the app.
 *
 * Not a target -- a limit. A cold start has already spent time the reader did
 * not choose to spend, and the opening is spending more of it. The stall
 * counts against it: `totalMs + bloomStallCapMs` is the worst case, and it is
 * this number exactly.
 */
export const LAUNCH_INTRO_BUDGET_MS = 1600;

/**
 * How far past the far corner the front travels, as a fraction of the radius
 * that would just reach it.
 *
 * The edge is noise-displaced, so a front that stops exactly at the corner
 * leaves the corner ragged on the frame it is supposed to have finished. The
 * overshoot is the displacement's own amplitude with a little to spare.
 */
export const BLOOM_OVERSHOOT = 1.18;

/**
 * How much bigger than its own scale the wallpaper starts.
 *
 * Small on purpose. A world that arrives at 1.2 and settles is a world being
 * presented; a world that arrives a hair large and relaxes has depth and is
 * not an effect. Anything past about 1.08 also starts to show the crop on a
 * painting that was composed for the screen it is on.
 */
export const WORLD_ARRIVAL_ZOOM = 1.06;

/**
 * The full opening: the rim, the bloom, the hero landing, the prompt, a hold,
 * an exit.
 *
 * The beats overlap on purpose. Things that each wait their turn read as a
 * list being recited; things that start while the one before is still moving
 * read as one event. The hero is already lifting while the front is still
 * crossing the screen, and the prompt starts typing before the hero has
 * landed, so the screen resolves at once rather than counting itself out.
 */
export function launchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const ignite: IntroBeat = { at: 0, ms: d.micro };
  const bloom: IntroBeat = { at: d.micro, ms: d.long + d.short };
  const type: IntroBeat = { at: d.medium, ms: d.long + d.micro };
  const blink: IntroBeat = { at: type.at + type.ms, ms: d.micro };
  const holdUntil = blink.at + blink.ms;
  return {
    ignite,
    bloom,
    bloomStallCapMs: d.medium,
    worldDeadlineAt: bloom.at + d.medium,
    settle: { at: d.micro, ms: d.long + d.long },
    hero: { at: d.short, ms: d.long + d.short },
    type,
    blink,
    skipArmedAt: d.long,
    holdUntil,
    exit: { at: holdUntil, ms: d.medium },
    totalMs: holdUntil + d.medium,
  };
}

/**
 * The same launch with Reduce Motion on: nothing blooms, nothing travels,
 * nothing types.
 *
 * The pack's world, its hero and its prompt are drawn where they finish, in
 * Home's own geometry, and the sheet holds for one short beat -- long enough
 * that the app's first frame is composed behind it rather than snapping in --
 * before cross-fading. The cross-fade is kept deliberately. Opacity is not
 * travel, and a dissolve is what the setting asks for *in place of* movement,
 * not something it asks us to remove as well; cutting straight to the app
 * would be a hard cut, which is a worse answer to "reduce motion" than a short
 * fade.
 *
 * `skipArmedAt` is 0 because there is nothing left to sit through.
 */
export function reducedLaunchIntroTimeline(d: MotionDurations): LaunchIntroTimeline {
  const still: IntroBeat = { at: 0, ms: 0 };
  return {
    ignite: still,
    bloom: still,
    bloomStallCapMs: 0,
    worldDeadlineAt: 0,
    settle: still,
    hero: still,
    type: still,
    blink: still,
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
