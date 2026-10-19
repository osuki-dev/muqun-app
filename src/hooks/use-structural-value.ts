import { useState } from 'react';

/** Plain data (arrays, plain objects, primitives) with the same contents. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameData(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  ) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
}

/**
 * `value`, keeping the identity it had last render while its contents are the
 * same. For data rebuilt on every render of a busy parent (a store ticking for
 * something this child does not show), so a memoized child receiving it stays
 * still until what it shows changes.
 */
export function useStructuralValue<T>(value: T): T {
  // React's "information from previous renders": a new value with new
  // contents is kept for the renders after this one.
  const [kept, setKept] = useState(value);
  if (sameData(kept, value)) return kept;
  setKept(() => value);
  return value;
}
