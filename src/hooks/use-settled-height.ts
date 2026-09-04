import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long a measurement is given to settle before it becomes state.
 *
 * Long enough to swallow a run of alternating measurements -- see below -- and
 * short enough to land well inside the reflow that caused them, so a height
 * that really did change still moves what depends on it within the same
 * animation.
 */
const MEASURE_WINDOW_MS = 50;

/**
 * A measured height, handed to React on the leading and trailing edge of a
 * window rather than on every measurement.
 *
 * `onLayout` is a native callback delivered inside the commit that laid the
 * view out, so the state it writes is a nested update in React's accounting.
 * One nested update is nothing. A run of them is the defect this exists for
 * (card #20): the bottom inset a dock is padded by can flip between its
 * keyboard-up and its keyboard-down value repeatedly while the keyboard
 * animates, and each flip re-measures the dock at the other of two heights.
 * Written straight through, that alternation is a chain of nested updates, and
 * a gateway streaming pane output commits the screen on top of it until the
 * chain passes React's limit of fifty: "Maximum update depth exceeded", thrown
 * from whichever setter the frame lands on, which drops the terminal to its
 * boundary and back -- the flicker. It needs both halves, which is why only a
 * live server ever showed it and the demo workspace never could.
 *
 * The throttle is the whole of the fix. The first measurement still lands at
 * once, so nothing waits on a height that really did change; an alternation
 * collapses to a single write on the trailing edge; and a write made from a
 * timer is not nested at all, so the chain cannot form.
 *
 * A hook rather than a paragraph repeated in two screens: both terminal
 * workspaces now hang the same dock off the same measurement, and a subtlety
 * this expensive to rediscover should exist once.
 */
export function useSettledHeight(initial: number): [number, (height: number) => void] {
  const [height, setHeight] = useState(initial);
  const measuredRef = useRef(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const measuredAtRef = useRef(0);

  const measure = useCallback((next: number) => {
    measuredRef.current = next;
    if (timerRef.current) return;
    const elapsed = Date.now() - measuredAtRef.current;
    if (elapsed >= MEASURE_WINDOW_MS) {
      measuredAtRef.current = Date.now();
      setHeight((current) => (current === next ? current : next));
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      measuredAtRef.current = Date.now();
      const settled = measuredRef.current;
      setHeight((current) => (current === settled ? current : settled));
    }, MEASURE_WINDOW_MS - elapsed);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return [height, measure];
}
