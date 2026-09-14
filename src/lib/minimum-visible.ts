/**
 * How long a transient state still has to stay on screen.
 *
 * Some states exist to be *seen*: a row acknowledging a tap, a spinner saying
 * the app heard you. When the work behind one finishes faster than the
 * transition announcing it, the honest-looking code -- set the state, do the
 * work, clear the state -- shows the reader nothing at all, and the tap reads
 * as ignored. On a fast connection the theme catalogue's download finished in
 * under a second and the pressed row never rendered a single frame.
 *
 * So the state carries a floor. This is the arithmetic for it, kept pure and
 * away from the component so it can be tested without a device: given when the
 * state went up and how long it must be visible for, how much of that is left.
 *
 * The minimum is a motion token at the call site (`DURATION.short`, the length
 * of the cross-fade that brings the state in), never a number written here --
 * a floor shorter than its own transition is not a floor.
 */
export function remainingVisibleMs(startedAt: number, minimumMs: number, now = Date.now()): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(minimumMs) || minimumMs <= 0) return 0;
  const elapsed = now - startedAt;
  // A clock that moved under us -- a manual change, a timezone database update
  // -- must not be read as "the state has been up for a week". Wait the whole
  // floor rather than none of it: the cost is one short beat, and the failure
  // it prevents is the state never being seen.
  if (!Number.isFinite(elapsed) || elapsed < 0) return minimumMs;
  return Math.max(0, minimumMs - elapsed);
}

/** Hands the frame back for `ms`, so a commit can paint before the next block. */
export function holdFor(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  // `setTimeout`, not a resolved promise: a microtask drains before the event
  // loop runs, so React would never commit and nothing would paint.
  return new Promise((resolve) => setTimeout(resolve, ms));
}
