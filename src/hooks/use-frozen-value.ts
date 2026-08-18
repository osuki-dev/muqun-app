import { useCallback, useRef, useState } from 'react';

/**
 * Which value a frozen view should be showing.
 *
 * The whole state machine of the freeze, kept separate from the hook so the rule
 * -- and only the rule -- is testable:
 *
 * - `flush` wins over everything. A pane switch has to paint its own first frame
 *   even if a finger is still down from the pane before it, because holding the
 *   old pane's frame under the new pane's gestures is worse than any jump.
 * - `frozen` holds whatever is already on screen. Nothing is lost by holding:
 *   the newest value is a prop, so the render that follows the release is
 *   handed it without anything having to buffer it.
 * - otherwise the newest value is the displayed value.
 */
export function nextFrozenValue<T>(
  displayed: T,
  input: { value: T; frozen: boolean; flush: boolean }
): T {
  if (input.flush) return input.value;
  return input.frozen ? displayed : input.value;
}

/**
 * `value`, held at whatever it was when `frozen` went true.
 *
 * Used to freeze the terminal frame for the length of a gesture. Re-laying the
 * pane out under a moving finger is what makes a stream unreadable to scroll
 * through: the reader is tracking a glyph that is moving for two unrelated
 * reasons at once -- their own drag and the output growing -- and the two do not
 * separate visually, so the whole grid reads as swimming rather than sliding.
 * Frozen, the pane under the finger is a still image and the only motion is the
 * drag itself.
 *
 * No buffer and no state: the caller's newest value is already a prop, so the
 * re-render that clears `frozen` (the gesture ending is a state change) carries
 * the newest value with it. `resetKey` flushes the hold.
 */
export function useFrozenValue<T>(value: T, frozen: boolean, resetKey: unknown): T {
  const displayedRef = useRef(value);
  const resetKeyRef = useRef(resetKey);
  const flush = resetKeyRef.current !== resetKey;
  resetKeyRef.current = resetKey;
  const displayed = nextFrozenValue(displayedRef.current, { value, frozen, flush });
  displayedRef.current = displayed;
  return displayed;
}

export type FreezeGate = {
  /** Whether this render must hold what is already on screen. */
  frozen: boolean;
  /** Called from the UI thread's messenger; safe to call with no change. */
  setActive: (active: boolean) => void;
};

/**
 * The freeze's on/off switch, closing on the gesture's schedule rather than on
 * React's.
 *
 * The two edges are not symmetric, and treating them as one piece of state was
 * the bug. A gesture starts on the UI thread; the gate is read on the JS thread
 * while rendering. Routing the closing edge through `useState` means the freeze
 * only takes hold once React has scheduled, rendered and committed a render of
 * its own -- and during a stream the JS thread is already busy parsing and
 * recording the burst that is arriving, so that is not one frame but several.
 * Anything the gateway delivers inside that window is applied under a finger
 * that is already moving. A single long drag pays for it once, which is why it
 * hid; a reader flicking through a live pane pays for it on every swipe.
 *
 * So the closing edge is a ref, read during render: the very next render --
 * almost always the arriving output's own -- sees a closed gate, with no render
 * of the gate's own to wait for. The opening edge is where a render is the
 * point, since applying the newest value IS the release, so it bumps state.
 *
 * Reading a ref during render is deliberate here. The value is not derived from
 * props or state: it is a fact about the outside world (is a finger on the
 * glass) at the instant the render runs, and reading it any later is exactly
 * the lag being fixed.
 */
export function useFreezeGate(): FreezeGate {
  const activeRef = useRef(false);
  const [, applyRelease] = useState(0);
  const setActive = useCallback((active: boolean) => {
    if (activeRef.current === active) return;
    activeRef.current = active;
    if (!active) applyRelease((release) => release + 1);
  }, []);
  return { frozen: activeRef.current, setActive };
}
