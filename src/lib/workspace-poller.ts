/**
 * A null refresh was superseded by another reader, not a connection failure.
 * Keep the watchdog alive without a busy loop or publishing stale results.
 */
export function startWorkspacePoller<T>({
  refresh,
  initial,
  onResult,
  schedule = (task, delay) => {
    const timer = setTimeout(task, delay);
    return () => clearTimeout(timer);
  },
}: {
  refresh: (initial: boolean) => Promise<T | null>;
  initial: boolean;
  onResult: (result: T) => number | null;
  schedule?: (task: () => void, delay: number) => () => void;
}): () => void {
  let stopped = false;
  let cancelTimer: (() => void) | undefined;

  async function poll(first: boolean) {
    if (stopped) return;
    const result = await refresh(first);
    if (stopped) return;
    const delay = result === null ? 1000 : onResult(result);
    if (!stopped && delay !== null) {
      cancelTimer = schedule(() => void poll(false), delay);
    }
  }

  void poll(initial);
  return () => {
    stopped = true;
    cancelTimer?.();
  };
}
