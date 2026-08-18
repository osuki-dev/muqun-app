import { useRef, type RefObject } from 'react';

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
  const ref = useRef(value);
  // eslint-disable-next-line react-hooks/refs -- deliberate: nothing renders from this ref, and an effect-written one is a commit stale. See the note above.
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
  const previous = useRef(key);
  // eslint-disable-next-line react-hooks/refs -- deliberate: this is the change detector itself, not a value being rendered. See the note above.
  const changed = previous.current !== key;
  // eslint-disable-next-line react-hooks/refs -- deliberate: same write, one render later.
  previous.current = key;
  return changed;
}
