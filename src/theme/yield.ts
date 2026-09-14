/**
 * Handing the frame back, in the middle of work that would otherwise hold it.
 *
 * Installing a theme is the one place in this app where a pure-JS hot loop runs
 * long enough to be seen: a `.muqun-theme` is inflated and CRC32'd entirely on
 * the JS thread, and a 25 MiB package is tens of millions of iterations of a
 * table loop. Nothing repaints while that runs, so a tap on a catalogue row
 * looked ignored and the progress it was reporting never drew a single frame.
 *
 * The fix is not a faster loop, it is a loop that stops. Every long stretch in
 * `package.ts` and `asset-stream.ts` is broken into blocks with one of these
 * between them, so React gets a commit and the reader gets a bar that moves.
 */

/** A yield point. Injectable so a test can count them without a clock. */
export type YieldFrame = () => Promise<void>;

/**
 * `setTimeout(0)`, deliberately, and none of the alternatives:
 *
 * - a resolved promise is a *microtask*, and the microtask queue drains before
 *   the event loop runs, so React never commits and nothing paints;
 * - `InteractionManager.runAfterInteractions` waits for animations and gestures
 *   to finish, and the sheet this progress is drawn in is itself animating in,
 *   so the work would not start until the reader stopped looking at it;
 * - `requestAnimationFrame` is closer, but it is throttled with the display and
 *   would pace the unpack at the frame rate rather than merely letting a frame
 *   through.
 *
 * `holdFor` in `src/lib/minimum-visible.ts` is the same primitive with a
 * duration, and it is about a state staying *visible*. This one is about the
 * thread being *available*, which is why it is its own name.
 */
export const yieldFrame: YieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
