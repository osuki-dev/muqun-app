/**
 * When a long-lived event stream has gone quiet for too long to be alive.
 *
 * The gateway's terminal event stream sends an SSE keep-alive comment every
 * 15 s (`terminal/routes.rs`), so a healthy connection is never silent for
 * longer than that. A half-open one -- the phone changed networks, a NAT
 * mapping expired, the gateway's host slept -- delivers nothing at all and
 * never errors, and the screen used to sit on it, falling back to its slow
 * output poll, until the OS happened to notice. Past this limit the stream is
 * treated as dead: aborted, and reopened through the normal retry path.
 *
 * Thirty-five seconds is two missed keep-alives plus slack for a slow radio.
 * Pure so the decision is tested without a stream; `use-pane-events` owns the
 * timer.
 */
export const STREAM_IDLE_LIMIT_MS = 35_000;

/** How often the watchdog looks. A stall is noticed within this of the limit. */
export const STREAM_WATCHDOG_TICK_MS = 5_000;

export function streamIsStalled(
  lastHeardAtMs: number,
  nowMs: number,
  limitMs: number = STREAM_IDLE_LIMIT_MS
): boolean {
  return nowMs - lastHeardAtMs >= limitMs;
}
