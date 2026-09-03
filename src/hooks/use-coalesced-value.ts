import { useEffect, useRef, useState } from 'react';

import { useLatestRef, useResetSignal } from '@/hooks/use-render-refs';

/**
 * Leading + trailing throttle for a value that changes in bursts.
 *
 * An agent printing fast pushes new `output` several times a second, and each
 * change re-parses the snapshot and re-records the SkPicture -- full JS work
 * plus native object churn. Redoing all of that for intermediate frames that
 * are overwritten a few milliseconds later is what pins the thread during a
 * burst. So the first change shows at once (a pane switch must never blank for
 * a window), intermediate values inside a window are dropped, and the window
 * always ends on the newest value -- the last line an agent prints can never be
 * the frame that gets thrown away.
 *
 * `resetKey` forces an immediate flush and restarts the window. Switching panes
 * has to show the new pane's first frame now; it must not inherit the previous
 * pane's in-flight window and paint a stale or blank frame while it expires.
 */
export function useCoalescedValue<T>(value: T, resetKey: unknown, intervalMs = 100): T {
  const [displayed, setDisplayed] = useState(value);
  // The newest value, read by the trailing timer. Kept current every render so
  // a timer that outlives a reset can only ever emit the latest value, never
  // resurrect a previous pane's frame.
  const latestRef = useLatestRef(value);
  const lastEmitRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useResetSignal(resetKey);

  // Adjusting state during render lets React re-render with the new value
  // before it paints, so a reset (pane switch) never commits a stale frame the
  // way a post-commit effect would. The flush counts as this window's leading
  // emit, so a burst arriving right after the switch is still throttled -- which
  // is why the clock is read and the window stamped here and not in an effect,
  // where the first burst frame would already have slipped through unthrottled.
  if (flush) {
    // oxlint-disable-next-line react/refs, react/purity -- deliberate: stamping the window during the flush render is the throttle. See above.
    lastEmitRef.current = Date.now();
    setDisplayed(value);
  }

  useEffect(() => {
    if (value === displayed) return;
    const elapsed = Date.now() - lastEmitRef.current;
    if (elapsed >= intervalMs) {
      // Leading edge, or the window already elapsed: show it now.
      lastEmitRef.current = Date.now();
      setDisplayed(value);
      return;
    }
    // Inside the window: drop this value but guarantee the window ends on
    // whatever the newest value is by then. One timer runs at a time; later
    // values in the same window only update latestRef, which the timer reads.
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      lastEmitRef.current = Date.now();
      setDisplayed(latestRef.current);
    }, intervalMs - elapsed);
  }, [value, displayed, intervalMs, latestRef]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return displayed;
}
