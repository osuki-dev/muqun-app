/**
 * The `CANCELLED` half of an abortable connect, for code that is not the
 * library: the offline demo's `connect` honours the same `signal` the real
 * one does, and rejects the same way, so the screen's cancel path is one
 * path whichever host it runs against. Macro-free, so it can be tested.
 */

/** An error shaped as the library's own, so `describeSshFailure` reads it alike. */
export function sshCancelledError(message = 'connection cancelled'): Error {
  const error = new Error(`RNSSH_CANCELLED: ${message}`);
  error.name = 'SshError';
  (error as { code?: string }).code = 'CANCELLED';
  return error;
}

/**
 * Resolves after `ms`, or rejects with `CANCELLED` the moment `signal`
 * aborts -- at once if it already has. The timer is cleared on abort, so a
 * cancelled wait holds nothing.
 */
export function waitUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(sshCancelledError('connection cancelled before it started'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(sshCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
