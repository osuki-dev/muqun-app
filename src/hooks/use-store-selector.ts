import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';

/**
 * A store slice that may be an object, kept by identity while `isEqual` says
 * it has not changed.
 *
 * zustand's `useStore` needs a selector to return a stable value, which holds
 * for a boolean but not for a derived object rebuilt from the state. This
 * keeps the previous result whenever the new one is equal to it, so the
 * component renders only when the answer changes, not whenever the state
 * does. A selector with a new identity is evaluated afresh and never compared
 * with the old one's result: its inputs are not the same inputs.
 */
export function useStoreSelector<S, T>(
  store: StoreApi<S>,
  selector: (state: S) => T,
  isEqual: (previous: T, next: T) => boolean
): T {
  const last = useRef<{ state: S; selector: (state: S) => T; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const previous = last.current;
    if (previous && previous.selector === selector && previous.state === state)
      return previous.value;
    const next = selector(state);
    const value =
      previous && previous.selector === selector && isEqual(previous.value, next)
        ? previous.value
        : next;
    last.current = { state, selector, value };
    return value;
  }, [store, selector, isEqual]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
