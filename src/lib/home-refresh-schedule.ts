type IntervalTimers<Id> = {
  setInterval: (fn: () => void, ms: number) => Id;
  clearInterval: (id: Id) => void;
};

/**
 * Whether a mounted-but-hidden Home should poll. A plain subscribable value,
 * not React state: the Pad overlay freezes Home while hidden, so a prop or a
 * context value change would never reach it. Running effects read this instead.
 */
export type HomeRefreshPause = {
  paused: () => boolean;
  set: (paused: boolean) => void;
  subscribe: (listener: (paused: boolean) => void) => () => void;
};

export function createHomeRefreshPause(initial = false): HomeRefreshPause {
  let paused = initial;
  const listeners = new Set<(paused: boolean) => void>();
  return {
    paused: () => paused,
    set: (next) => {
      if (next === paused) return;
      paused = next;
      listeners.forEach((listener) => listener(next));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const systemTimers: IntervalTimers<ReturnType<typeof setInterval>> = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

/**
 * One of Home's polling loops: a refresh now, then one per interval, until the
 * returned stop runs. While `pause` says paused nothing is scheduled; when it
 * resumes, one refresh runs at once (Home is fresh the moment it reappears) and
 * the interval starts again.
 */
export function scheduleHomeRefresh<Id = ReturnType<typeof setInterval>>({
  intervalMs,
  refresh,
  pause,
  timers = systemTimers as unknown as IntervalTimers<Id>,
}: {
  intervalMs: number;
  refresh: () => void;
  pause?: HomeRefreshPause | null;
  timers?: IntervalTimers<Id>;
}): () => void {
  let timer: { id: Id } | null = null;
  const start = () => {
    refresh();
    timer = { id: timers.setInterval(refresh, intervalMs) };
  };
  const halt = () => {
    if (timer) timers.clearInterval(timer.id);
    timer = null;
  };
  if (!pause?.paused()) start();
  const unsubscribe = pause?.subscribe((paused) => {
    if (paused) halt();
    else if (!timer) start();
  });
  return () => {
    unsubscribe?.();
    halt();
  };
}
