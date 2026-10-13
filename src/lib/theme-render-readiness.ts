/** Mounted theme renderers report native display/draw completion, independently of prefetch. */
const pending = new Map<string, symbol>();
const listeners = new Set<() => void>();

export function beginThemeRender(key: string): () => void {
  const generation = Symbol(key);
  pending.set(key, generation);
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    if (pending.get(key) !== generation) return;
    pending.delete(key);
    for (const listener of listeners) listener();
  };
}

/**
 * Only focused, opted-in route renderers register. Failure, blur or unmount
 * settles them. The deadline is fixed per wait, never extended by new arrivals.
 */
export function waitForThemeRender(timeoutMs = 5000): Promise<boolean> {
  if (pending.size === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve(ready);
    };
    const check = () => {
      if (pending.size === 0) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    listeners.add(check);
  });
}

/** A missing/failed canvas cannot retain or resurrect a captured screen indefinitely. */
export function createCoverReadiness(keys: Iterable<string>, timeoutMs = 5000) {
  const waiting = new Set(keys);
  let complete = (_key: string, _ready: boolean) => {};
  const promise = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    complete = (key, ready) => {
      if (!waiting.has(key)) return;
      if (!ready) return finish(false);
      waiting.delete(key);
      if (waiting.size === 0) finish(true);
    };
    if (waiting.size === 0) finish(true);
  });
  return { promise, complete };
}
