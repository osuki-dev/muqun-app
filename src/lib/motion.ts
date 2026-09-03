/**
 * The app's single source of interaction motion.
 *
 * Every duration and every easing in Muqun comes from `@osuki-dev/ui`'s motion
 * tokens, and every entering/exiting/timing built here already answers the
 * device's "reduce motion" setting. Screens should import from this module
 * rather than reaching for `FadeIn.duration(180)` by hand: a literal duration
 * at a call site is invisible to a global tuning pass, and forty of them made
 * one impossible.
 *
 * The design system's own rule applies throughout -- "percussive, mechanical
 * precision -- no spring, no bounce" -- so everything here is `withTiming` on
 * the system ease-out. There is deliberately no spring helper.
 */
import { motion as tokens } from '@osuki-dev/ui';
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  FadeOutDown,
  FadeOutLeft,
  FadeOutRight,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
  ZoomIn,
  ZoomOut,
  type WithTimingConfig,
} from 'react-native-reanimated';

/**
 * Durations, in milliseconds, straight off the design system.
 *
 * `micro` is a state flip you should barely notice, `short` a control changing
 * its mind, `medium` one surface replacing another, `long` a whole page.
 */
export const DURATION = {
  micro: tokens.micro,
  short: tokens.short,
  medium: tokens.medium,
  long: tokens.long,
} as const;

export type DurationToken = keyof typeof DURATION;

/**
 * The named presets, for the cases the system has already made a call on:
 * a button's press state, a toggle, a segmented control, a modal, a dropdown.
 * Preferred over a raw `DURATION` where one of them fits, because retuning
 * every dropdown in the app should not mean finding every `micro`.
 */
export const PRESET = {
  button: tokens.button.duration,
  toggle: tokens.toggle.duration,
  segmented: tokens.segmented.duration,
  modal: tokens.modal.duration,
  dropdown: tokens.dropdown.duration,
} as const;

export type PresetToken = keyof typeof PRESET;

/**
 * Press feedback, which sits below the design system's smallest token on
 * purpose.
 *
 * `micro` is 150 ms, and a scale that takes 150 ms to answer a finger reads as
 * lag rather than as a press -- the touch is usually over before the transform
 * arrives. The system has no token for this because it has no press primitive;
 * these two numbers are the app's own, and they live here so that the tuning
 * pass the tokens exist for can still reach them.
 */
export const PRESS = {
  /** Down, so short it is felt rather than seen. */
  in: 80,
  /** Up, slightly longer: the release should settle, not snap. */
  out: 120,
} as const;

/**
 * The beat between one item in a sequence and the next.
 *
 * A stagger is not a duration -- it is the gap between two of them -- so it has
 * no design-system token of its own, and these are the app's numbers in the same
 * way `PRESS` is. They are here rather than at the call site because a home
 * screen that lists servers and then grows each server's agents off it is one
 * sequence, and retuning that sequence should be one edit.
 *
 * `row` is deliberately shorter than `card`: rows inside a card belong to the
 * same gesture, and a beat as long as the one between cards makes a four-agent
 * machine take a second to finish arriving.
 */
export const STAGGER = {
  /** Between sibling cards in the server list. */
  card: 55,
  /** Between pane rows filling in under one card. */
  row: 32,
} as const;

/**
 * How far a revealing element travels, in points.
 *
 * The previous home screen used six, which is below the threshold where a rise
 * reads as a rise at all: the fade finished and the movement was never seen.
 */
export const RISE_DISTANCE = 14;

/**
 * One full breath of the "answering right now" ring on a live status dot.
 *
 * A period rather than a transition -- the same category as `LogoLoader`'s
 * breath -- so it is a good deal longer than any token here. It has to read as
 * a heartbeat at the edge of vision, not as something asking to be watched.
 */
export const PULSE_PERIOD = 2600;

/**
 * How far a status dot overshoots when the fact behind it changes.
 *
 * Small on purpose: the design system forbids bounce, so this is a single
 * timed swell and settle, not an oscillation.
 */
export const STATE_POP_SCALE = 1.5;

/** The design system's ease-out, in the form Reanimated wants. */
export const EASE_OUT = Easing.bezier(
  tokens.easeOut[0],
  tokens.easeOut[1],
  tokens.easeOut[2],
  tokens.easeOut[3]
);

/**
 * Resolves whichever way a caller names a duration -- a token, a preset, or a
 * number for the rare case with no token of its own.
 *
 * Exported for the token test, which is what actually keeps literals out of
 * the screens.
 *
 * A worklet, for the reason spelled out on `timing` below.
 */
export function resolveDuration(value: DurationToken | PresetToken | number): number {
  'worklet';
  if (typeof value === 'number') return value;
  if (value in DURATION) return DURATION[value as DurationToken];
  return PRESET[value as PresetToken];
}

/**
 * A `withTiming` config on the system ease-out that stops itself when the
 * device asks for reduced motion.
 *
 * `ReduceMotion.System` rather than the `useReducedMotion()` hook: the check
 * lands on the UI thread with the animation, so a value driven from a worklet
 * -- which is most of them -- gets it too, and no component has to thread a
 * boolean through its callbacks.
 *
 * A WORKLET, and that word is the whole reason this note exists.
 *
 * Half the app's animation starts on the UI thread: a gesture callback is a
 * worklet, and `withTiming(x, timing('short'))` written inside one is the most
 * natural line in the world to write. Without the directive that line is a
 * crash -- a plain function captured by a worklet crosses the boundary as a
 * *remote function*, which the UI runtime may only schedule, never call, and
 * calling one anyway takes the whole app down with "[Worklets] Tried to
 * synchronously call a Remote Function". Not a warning, not a red box in
 * release: a native `CppException` on the main thread.
 *
 * It cost the image viewer, where the pinch's `onEnd` asked for a duration and
 * the app died in the reader's hand. The fix belongs here rather than at that
 * call site, because the call site was not wrong -- every other one like it
 * would have been the next crash. A worklet is still an ordinary function on
 * the JS thread, so the render-time callers are unaffected.
 */
export function timing(
  duration: DurationToken | PresetToken | number = 'short',
  overrides?: Omit<WithTimingConfig, 'duration' | 'easing'>
): WithTimingConfig {
  'worklet';
  return {
    duration: resolveDuration(duration),
    easing: EASE_OUT,
    reduceMotion: ReduceMotion.System,
    ...overrides,
  };
}

/**
 * An instant `withTiming` config, for the jump-to-the-far-side beat in a
 * carousel. Still routed through here so it reads as motion rather than as an
 * assignment someone forgot to animate.
 */
export const INSTANT: WithTimingConfig = {
  duration: 0,
  reduceMotion: ReduceMotion.Never,
};

/**
 * Layout-animation builders.
 *
 * Each is a function rather than a constant because Reanimated's builders are
 * mutable: `FADE_IN.delay(40)` would retune the shared instance for every
 * other caller in the app.
 */

export const fadeIn = (duration: DurationToken | PresetToken | number = 'micro') =>
  FadeIn.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const fadeOut = (duration: DurationToken | PresetToken | number = 'micro') =>
  FadeOut.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const fadeInDown = (duration: DurationToken | PresetToken | number = 'dropdown') =>
  FadeInDown.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const fadeOutDown = (duration: DurationToken | PresetToken | number = 'dropdown') =>
  FadeOutDown.duration(resolveDuration(duration))
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System);

export const fadeOutUp = (duration: DurationToken | PresetToken | number = 'micro') =>
  FadeOutUp.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const fadeInLeft = (duration: DurationToken | PresetToken | number = 'short') =>
  FadeInLeft.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const fadeInRight = (duration: DurationToken | PresetToken | number = 'short') =>
  FadeInRight.duration(resolveDuration(duration))
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System);

export const fadeOutLeft = (duration: DurationToken | PresetToken | number = 'short') =>
  FadeOutLeft.duration(resolveDuration(duration))
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System);

export const fadeOutRight = (duration: DurationToken | PresetToken | number = 'short') =>
  FadeOutRight.duration(resolveDuration(duration))
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System);

export const zoomIn = (duration: DurationToken | PresetToken | number = 'micro') =>
  ZoomIn.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export const zoomOut = (duration: DurationToken | PresetToken | number = 'micro') =>
  ZoomOut.duration(resolveDuration(duration)).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/**
 * A reveal that rises into place, with a delay so a list of them can be one
 * sequence rather than a simultaneous flash.
 *
 * Takes its delay in milliseconds because that is what a stagger produces --
 * `index * STAGGER.card` -- and there is no token for the seventh card.
 */
export const riseIn = (delay = 0) =>
  FadeInDown.duration(DURATION.medium)
    .delay(delay)
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System)
    .withInitialValues({ transform: [{ translateY: RISE_DISTANCE }] });

/**
 * The list/stack reflow: rows closing the gap after a delete, a banner column
 * restacking, a dock growing a row. Paired with `fadeIn`/`fadeOut` on the rows
 * themselves so nothing ever teleports.
 */
export const listLayout = (duration: DurationToken | PresetToken | number = 'short') =>
  LinearTransition.duration(resolveDuration(duration))
    .easing(EASE_OUT)
    .reduceMotion(ReduceMotion.System);
