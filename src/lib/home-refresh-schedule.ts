/**
 * When Home asks each computer about Continue again.
 *
 * Home used to ask every paired computer every 30 s, offline ones included,
 * which was about 35 requests and a dozen refused connections a minute while
 * nothing changed. Now each computer has its own due time:
 *
 * - **Answering, task socket closed:** every {@link HOME_CONTINUE_REFRESH_MS}.
 * - **Answering, task socket open:** every {@link HOME_CONTINUE_LIVE_REFRESH_MS}.
 *   The socket already tells the app when work changes; the poll only keeps the
 *   statuses and the "Seen" ages honest.
 * - **Not answering, or its reads failing:** backs off from 30 s, doubling, to
 *   {@link HOME_CONTINUE_BACKOFF_MAX_MS}. A computer that was not answering
 *   when its read failed is asked at once when it answers again; one whose
 *   reads fail while it answers `/health` (its Herdr down, say) keeps backing
 *   off. The app coming back to the
 *   foreground, the network changing, or the reader opening that computer's
 *   card or settings asks again at once ({@link retryHomeRefresh}).
 *
 * The record of attempts is module state rather than component state: Home and
 * the Pad workspace rail both run the loop, and a computer that has just been
 * asked by one must not be asked again by the other on its way in.
 */

export const HOME_CONTINUE_REFRESH_MS = 30_000;
export const HOME_CONTINUE_LIVE_REFRESH_MS = 60_000;
export const HOME_CONTINUE_BACKOFF_MAX_MS = 5 * 60_000;

/**
 * A tick that lands a hair before a due time still counts. Timers drift, and
 * missing by 5 ms must not cost a whole extra tick.
 */
const DUE_SLACK_MS = 1_000;

export type HomeRefreshAttempt = {
  atMs: number;
  failures: number;
  /** Whether the computer was answering when the last read failed. */
  liveAtFailure?: boolean;
};

/** How long after an attempt the computer is due again. */
export function homeRefreshDelay(failures: number, socketLive: boolean): number {
  if (failures > 0) {
    return Math.min(HOME_CONTINUE_REFRESH_MS * 2 ** (failures - 1), HOME_CONTINUE_BACKOFF_MAX_MS);
  }
  return socketLive ? HOME_CONTINUE_LIVE_REFRESH_MS : HOME_CONTINUE_REFRESH_MS;
}

/**
 * Whether a computer is due now. `live`: it is answering now; a failing
 * computer that was not answering when it failed is then due at once.
 */
export function homeRefreshDue(
  attempt: HomeRefreshAttempt | undefined,
  nowMs: number,
  socketLive: boolean,
  live = false
): boolean {
  if (!attempt) return true;
  if (attempt.failures > 0 && live && attempt.liveAtFailure === false) return true;
  return nowMs - attempt.atMs >= homeRefreshDelay(attempt.failures, socketLive) - DUE_SLACK_MS;
}

const attempts = new Map<string, HomeRefreshAttempt>();
const retryListeners = new Set<() => void>();

export function homeRefreshAttempt(serverId: string): HomeRefreshAttempt | undefined {
  return attempts.get(serverId);
}

/** `serverId` is due now whatever its last attempt said: the reader just chose it. */
export function forgetHomeRefresh(serverId: string): void {
  attempts.delete(serverId);
}

/** A refresh of `serverId` starts now: it is not due again until its delay has passed. */
export function startHomeRefresh(serverId: string, atMs: number): void {
  attempts.set(serverId, { atMs, failures: attempts.get(serverId)?.failures ?? 0 });
}

/**
 * How the refresh started by {@link startHomeRefresh} ended; `live`, whether
 * the computer was answering when it did.
 */
export function endHomeRefresh(serverId: string, ok: boolean, live: boolean): void {
  const attempt = attempts.get(serverId);
  if (!attempt) return;
  attempts.set(
    serverId,
    ok
      ? { atMs: attempt.atMs, failures: 0 }
      : { atMs: attempt.atMs, failures: attempt.failures + 1, liveAtFailure: live }
  );
}

/**
 * Forget the backoff -- for one computer, or for all of them -- and ask any
 * running loop to look again now. A computer that was answering keeps its
 * cadence; only one that was failing is asked early.
 */
export function retryHomeRefresh(serverId?: string): void {
  let changed = false;
  for (const [id, attempt] of attempts) {
    if (serverId !== undefined && id !== serverId) continue;
    if (attempt.failures === 0) continue;
    attempts.delete(id);
    changed = true;
  }
  if (!changed) return;
  for (const listener of [...retryListeners]) listener();
}

/**
 * Ask any running loop to read `serverId` again now, whatever its cadence:
 * something was just sent to it, and its statuses are about to change.
 */
export function refreshHomeNow(serverId: string): void {
  attempts.delete(serverId);
  for (const listener of [...retryListeners]) listener();
}

/** Called after {@link retryHomeRefresh} cleared a backoff. Returns the unsubscribe. */
export function onHomeRefreshRetry(listener: () => void): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

/** Test seam: the record is process-wide. */
export function forgetHomeRefreshAttempts(): void {
  attempts.clear();
}
