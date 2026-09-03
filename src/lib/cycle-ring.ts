/**
 * Stepping around a ring of named things that a swipe cycles through.
 *
 * The server screen now has two of these -- the session's workspaces, on a
 * swipe of the title pill, and the workspace's tabs, on a two-finger swipe of
 * the pane -- and they answer the same four questions: is there anywhere to go,
 * where am I, what is one step away, and what is one step away from where the
 * finger has already got to during a burst. Those answers are index arithmetic
 * and nothing else, so they live here once rather than once per ring.
 *
 * What is deliberately *not* here is anything either ring does not share: what
 * a workspace remembers is a tab and a pane, what a tab remembers is a pane,
 * and the thresholds that decide a gesture is a swipe at all differ because the
 * gestures do. Those stay with their own module.
 */

export type CycleDirection = 'next' | 'previous';

/** Only what cycling reads, so tests need no gateway entity. */
export type RingItem = {
  id: string;
  title: string;
};

export type CycleTarget = {
  id: string;
  title: string;
  /** 1-based place in the ring. Read by the screen; not drawn on its own. */
  position: number;
  total: number;
};

/**
 * A ring of one has nowhere to go, and a swipe that quietly did nothing would
 * read as a dropped gesture -- so the gesture is switched off entirely in that
 * case rather than made a no-op.
 */
export function canCycle(items: RingItem[]): boolean {
  return items.length > 1;
}

/**
 * Where the current item sits, for the indicator. `null` when the selection
 * names something the session no longer has, which is the same answer as
 * "nothing to show".
 */
export function ringPosition(items: RingItem[], id: string): CycleTarget | null {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return {
    id: items[index].id,
    title: items[index].title,
    position: index + 1,
    total: items.length,
  };
}

/**
 * The item one step in `direction`, wrapping at either end.
 *
 * An unknown current item is not an error: a swipe then lands on the first one
 * going forward and the last one going back, which is what a user who just had
 * one closed under them expects from the next swipe.
 */
export function stepRing(
  items: RingItem[],
  id: string,
  direction: CycleDirection
): CycleTarget | null {
  if (!canCycle(items)) return null;
  const total = items.length;
  const current = items.findIndex((item) => item.id === id);
  const step = direction === 'next' ? 1 : -1;
  // A missing current item starts from "before the first", so `next` lands on
  // index 0 and `previous` on the last one.
  const from = current < 0 ? (direction === 'next' ? -1 : 0) : current;
  const index = (from + step + total) % total;
  const target = items[index];
  return { id: target.id, title: target.title, position: index + 1, total };
}

/**
 * Where the *next* swipe of a burst lands.
 *
 * A swipe is felt immediately but applied a beat later, so during fast swiping
 * the item the screen is showing (`committedId`) lags behind the one the finger
 * has already reached (`pendingId`). Stepping from the screen's item in that
 * window makes every swipe after the first recompute the same target: five
 * flicks move one step, not five. Stepping from the pending one makes a burst
 * travel as far as the fingers asked.
 *
 * `pendingId` is dropped when it names something the session no longer has,
 * which is the same fallback a stale selection already gets.
 */
export function stepRingFrom(
  items: RingItem[],
  committedId: string,
  pendingId: string | null,
  direction: CycleDirection
): CycleTarget | null {
  const known = pendingId !== null && items.some((item) => item.id === pendingId);
  return stepRing(items, known ? (pendingId as string) : committedId, direction);
}

/**
 * Which way the ring turned, given only where it was and where it ended up.
 *
 * For a move nothing on this ring asked for: a deep link, a picker, the gateway
 * reconciling its own focus. The carousel that shows a switch needs a direction
 * and there is no gesture to read one off, so it is inferred from the two
 * positions -- and inferred *the short way round*, because that is how a ring is
 * read: on a ring of five, fourth to first is one step forward, not three back.
 *
 * `null` when there is nothing to show: the same item, or one of the two is no
 * longer on the ring. A move onto or off a workspace that has since been closed
 * has no direction that means anything, and guessing one would animate a lie.
 *
 * Exactly half way round -- two apart on a ring of four -- is called `next`.
 * Either answer is as true as the other there, and a rule that always picks one
 * beats one that depends on which end you counted from.
 */
export function cycleDirectionBetween(
  items: RingItem[],
  fromId: string,
  toId: string
): CycleDirection | null {
  if (fromId === toId) return null;
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return null;
  const total = items.length;
  const forward = (to - from + total) % total;
  return forward * 2 <= total ? 'next' : 'previous';
}

// `cycleIndicatorLabel` used to live here and produced "muqun · 3/4". Card #665
// retired it: the switch indicator now addresses a panel the way the panels
// sheet does, which is a fact about where the selection is rather than about
// where a ring index is, so it is built from the screen's own data in
// `@/lib/pane-address` instead of from a cycle target.
