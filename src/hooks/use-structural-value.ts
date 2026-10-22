import { useState } from 'react';

import { sameData } from '@/lib/same-data';

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
