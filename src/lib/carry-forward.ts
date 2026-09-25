/**
 * A value one render hands to the next, for derivations that reuse last
 * render's objects so unchanged rows keep their identity.
 *
 * These used to be refs read and written inside a `useMemo`, which React
 * Compiler treats as touching refs during render and so declines to compile the
 * component. A box made once with `useState` is the same per-instance storage
 * the ref was; reading and writing it through `carryForward` keeps the write out
 * of the component body, which is what the compiler needs to see.
 *
 *     const [previousRows] = useState(() => carryBox<Row[]>([]));
 *     const rows = useMemo(
 *       () => carryForward(previousRows, (previous) => build(input, previous)),
 *       [input, previousRows]
 *     );
 */
export type CarryBox<T> = { current: T };

export function carryBox<T>(initial: T): CarryBox<T> {
  return { current: initial };
}

/** Build from the previous value, remember the result for next time, return it. */
export function carryForward<T>(box: CarryBox<T>, build: (previous: T) => T): T {
  const next = build(box.current);
  box.current = next;
  return next;
}
