import { useEffect, useEffectEvent, useState } from 'react';

/**
 * A clock that moves only when one of the caller's deadlines passes.
 *
 * For a screen whose decisions turn on time at known instants -- a probe
 * stops speaking for the present 45 s after it answered, a Sent row stops
 * claiming a computer after two minutes -- and which must not re-render on a
 * timer to notice. `nextDeadline(afterMs)` names the first instant later than
 * `afterMs` at which an answer could change; the clock jumps to the real time
 * then, and not before. `subscribe` is the stores those deadlines come from, so
 * a new one is scheduled as soon as it exists. It must be a stable function.
 *
 * The returned time may lag the wall clock, but never across a deadline: one
 * that has already passed fires at once.
 */
export function useDeadlineNow(
  subscribe: (onChange: () => void) => () => void,
  nextDeadline: (afterMs: number) => number | undefined
): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const next = useEffectEvent((afterMs: number) => nextDeadline(afterMs));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const at = next(nowMs);
      if (at === undefined) return;
      timer = setTimeout(() => setNowMs(Date.now()), Math.max(0, at - Date.now()));
    };
    schedule();
    const unsubscribe = subscribe(schedule);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [nowMs, subscribe]);
  return nowMs;
}
