import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * The three render-time ref patterns this app relies on, owned in one place.
 *
 * The React Compiler lint (`react-hooks/refs`) rejects reading or writing
 * `ref.current` during render, and it is right about the general case: a render
 * that derives what it paints from a ref does not re-run when that ref changes.
 * None of the three below do that. They are the narrow, documented exceptions:
 *
 * - `useLatestRef` -- a mailbox for callbacks that are deliberately built once.
 *   Nothing renders from it.
 * - `useLazyRef` -- React's own "create the initial value once" idiom, which has
 *   no effect-based equivalent that still has the object ready on first render.
 * - `useResetSignal` -- "did this key change since the last render", the input to
 *   React's documented adjust-state-during-render pattern.
 * - `useStableHandler` -- one function identity for the life of the component
 *   that always calls the newest handler, for gestures built once.
 * - `useLatestReader` -- `useLatestRef` handed out as a function, for a
 *   component React Compiler should be able to compile.
 *
 * Keeping them here means the suppression is written down once, with the reason,
 * instead of being re-argued at every call site.
 */

/**
 * A ref that always holds the newest `value`.
 *
 * For callbacks that must be stable -- a gesture handler registered with a
 * native view, an event subscription that must not be torn down and rebuilt on
 * every state change -- but still need to act on current data. The callback
 * reads `.current` when it fires, which is outside render and entirely legal;
 * only the write below is during render.
 *
 * The write has to be during render, not in an effect. An effect-written ref is
 * one commit stale, so anything that fires between a render and the effect
 * flush -- a gesture that lands mid-transition, an SSE frame arriving on the
 * same tick -- reads the previous render's value. Writing here means the ref is
 * never behind what was rendered.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  // The render-time write above is the point of this hook; React Compiler would
  // refuse it, so it stays uncompiled on purpose.
  'use no memo';
  const ref = useRef(value);
  // oxlint-disable-next-line react/refs -- deliberate: nothing renders from this ref, and an effect-written one is a commit stale. See the note above.
  ref.current = value;
  return ref;
}

/**
 * A ref holding one instance, built on first render and never rebuilt.
 *
 * For objects whose identity is the point -- a search with its own debounce and
 * generation counter, say, where a second instance would mean two sets of
 * in-flight requests racing to call back. `create` is only ever called once, on
 * the render that finds the ref empty; later renders may pass a fresh closure
 * and it is discarded unused.
 */
export function useLazyRef<T>(create: () => T): RefObject<T> {
  const ref = useRef<T | null>(null);
  // Written as one statement against a null-initialised ref on purpose: that is
  // the exact shape the React Compiler recognises as lazy initialisation and
  // leaves alone, so this needs no suppression.
  if (ref.current === null) ref.current = create();
  return ref as RefObject<T>;
}

/**
 * True on the one render where `key` differs from the render before it.
 *
 * The trigger for a reset: a pane switch has to paint the new pane's own first
 * frame rather than inherit whatever the previous pane left mid-flight. Feeding
 * React's adjust-state-during-render pattern, so the correction lands before the
 * paint -- an effect would commit the stale frame first and then replace it,
 * which is the flash this exists to avoid.
 *
 * A ref rather than the `useState` spelling of the same pattern because the
 * callers that need it hold no state at all; giving them state to detect a
 * change would add a render they do not have today.
 */
export function useResetSignal(key: unknown): boolean {
  // The render-time read and write are the change detector itself; React
  // Compiler would refuse them, so it stays uncompiled on purpose.
  'use no memo';
  const previous = useRef(key);
  // oxlint-disable-next-line react/refs -- deliberate: this is the change detector itself, not a value being rendered. See the note above.
  const changed = previous.current !== key;
  // oxlint-disable-next-line react/refs -- deliberate: same write, one render later.
  previous.current = key;
  return changed;
}

/**
 * A function whose identity never changes and which calls the newest `handler`.
 *
 * For a gesture that is built once -- rebuilding `Gesture.Pan()` every render
 * drops and re-registers its native handler on every state change -- but must
 * still act on what the component is showing now. The handler is picked up
 * after each commit, exactly as the `ref` + `useEffect` + `useCallback` this
 * replaces did at its call sites, so a gesture firing between a render and its
 * effect flush still runs the previous handler, as it always has.
 *
 * `'use no memo'` because the ref is the implementation: kept here, the
 * components that use it hold no ref of their own and React Compiler can
 * compile them, which it cannot while their gesture callbacks reach a ref.
 */
export function useStableHandler<Args extends unknown[]>(
  handler: (...args: Args) => void
): (...args: Args) => void {
  'use no memo';
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  return useCallback((...args: Args) => {
    latest.current(...args);
  }, []);
}

/**
 * `useLatestRef`, handed out as a function that reads it.
 *
 * Written during render exactly as `useLatestRef` is, so a read never lags what
 * was rendered. The difference is only what the caller holds: a function rather
 * than the ref. React Compiler follows a ref into every callback that reaches
 * it and will not compile a component whose gesture handlers do; a reader
 * returned from a hook is opaque to it. `'use no memo'` keeps the compiler out
 * of this hook, which is where the render-time write lives.
 */
export function useLatestReader<T>(value: T): () => T {
  'use no memo';
  const ref = useRef(value);
  // oxlint-disable-next-line react/refs -- deliberate: the same render-time write as `useLatestRef`; see there.
  ref.current = value;
  return useCallback(() => ref.current, []);
}
