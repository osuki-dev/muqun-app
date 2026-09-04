import { useCallback, useEffect, useRef, useState } from 'react';

import { useLatestRef } from '@/hooks/use-render-refs';

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

/**
 * A measured height and the dock shape it was measured under.
 *
 * `shape` is null before anything has been measured at all, which is the one
 * state that must adopt whatever arrives next: the initial height is a guess.
 */
export interface SteadyHeight {
  shape: string | null;
  height: number;
}

/**
 * The dock height the PTY is sized by: the height the dock had when it last
 * became a different dock.
 *
 * `useSettledHeight` answers "how tall is the dock now", and that is the right
 * question for the canvas, which insets by it and pays nothing for a new
 * answer. It is the wrong question for the PTY. A new answer there is a
 * `window-change`, a `SIGWINCH`, and -- on any shell whose prompt spans more
 * than one line -- a full reprint of the prompt, because that is how zsh's line
 * editor redraws after the screen has changed size underneath it. One reprint
 * per keystroke is the defect this exists for.
 *
 * The measured height is not "how much of the bottom is permanently gone",
 * which is what the grid arithmetic above it claims to be subtracting. It moves
 * for reasons the terminal's size has nothing to do with: the composer wraps
 * onto a second line as a long command is typed, the composer takes focus and
 * grows, the key row swaps what it is carrying. Measured on a booted emulator,
 * typing one long line into the composer walked the PTY from 32 rows to 30, a
 * window change per wrap, each one answered by a fresh copy of the prompt.
 *
 * So the height the grid is sized by follows the dock's *shape* instead -- the
 * app's keyboard is up or it is not, there is a key row or there is not, an
 * editor owns the screen or it does not. While that holds this holds, whatever
 * the dock measures in the meantime; when it changes, the dock is a different
 * dock and the next thing it measures is the new answer. The shape is recorded
 * at measurement time rather than at render time on purpose: `onLayout` runs
 * after the dock has been laid out for its new shape, so the pair that arrives
 * there is the only pair known to belong together.
 */
export function nextSteadyHeight(previous: SteadyHeight, measurement: SteadyHeight): SteadyHeight {
  // The same dock, measured again. Whatever it says now, it is covering what it
  // was covering, and the far side is not told anything.
  if (previous.shape === measurement.shape) return previous;
  return measurement;
}

/**
 * One measurement of the dock, read two ways: as the height the canvas insets
 * by right now, and as the height the grid -- and therefore the PTY -- is
 * sized by for as long as the dock keeps its shape.
 *
 * Both come off the same `onLayout`, because they are the same measurement and
 * two of them would be two things to keep in step. `measure` writes the settled
 * half on every call (see `useSettledHeight` for why that is throttled) and the
 * steady half only when the shape it arrives with is new, so the nested update
 * card #20 is about cannot come back through this door: a dock that is merely
 * re-measured returns the identical object and React stops there.
 */
export function useDockMeasurement(
  initial: number,
  shape: string
): { live: number; steady: number; measure: (height: number) => void } {
  const [live, measureLive] = useSettledHeight(initial);
  const [steady, setSteady] = useState<SteadyHeight>({ shape: null, height: initial });
  // The shape the *next* measurement will arrive under. A ref rather than a
  // dependency because `measure` is handed to an `onLayout` and must not be
  // rebuilt every time the dock changes what it is showing.
  const shapeRef = useLatestRef(shape);

  const measure = useCallback(
    (height: number) => {
      measureLive(height);
      setSteady((previous) => nextSteadyHeight(previous, { shape: shapeRef.current, height }));
    },
    [measureLive, shapeRef]
  );

  return { live, steady: steady.height, measure };
}
