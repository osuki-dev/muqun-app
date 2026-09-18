/**
 * Swiping the agent header's title pill from one session to the next.
 *
 * The screen owns the selection and the gesture; everything here is the part
 * that can be reasoned about without a device: which session a direction lands
 * on, whether there is one at all, and whether a finished drag was a swipe.
 *
 * The obvious thing to do would have been to reuse `@/lib/cycle-ring`, which
 * the terminal's workspace and tab swipes already share. It is deliberately not
 * reused, for one reason: a ring wraps, and this does not.
 *
 * A ring of workspaces is a closed set the reader chose, and arriving back at
 * the first one after the last is the answer they expect. The session strip is
 * an open, growing list in recency order with a root's subagents folded into
 * it, and wrapping from the newest session to the oldest -- across a tree
 * boundary, past sessions they have never opened -- is not a switch, it is
 * getting lost. So the ends are ends: the neighbour of the first session going
 * back is nothing, the pill springs back, and the mark on that side is not
 * drawn in the first place. The affordance and the behaviour agree.
 */

export type SessionSwipeDirection = 'next' | 'previous';

/** Only what the swipe reads, so tests need no gateway entity. */
export type SwipeableSession = { asid: string };

/** Which sides of the current session have somewhere to go. */
export type SessionNeighbours = {
  previous: string | undefined;
  next: string | undefined;
};

/**
 * A workspace with one session has nowhere to go, and a swipe that quietly did
 * nothing would read as a dropped gesture -- so the gesture is switched off
 * entirely in that case rather than made a no-op. The same test decides whether
 * the edge marks are drawn at all.
 */
export function canSwipeSessions(order: readonly SwipeableSession[]): boolean {
  return order.length > 1;
}

/**
 * The sessions either side of this one in the strip's own order.
 *
 * `undefined` on a side means the end of the list -- not a wrap -- and an
 * `asid` the strip does not list gets `undefined` on both sides. A session that
 * was closed under the reader therefore disables the gesture rather than
 * teleporting them somewhere, until the strip catches up and names an active
 * session again.
 */
export function sessionNeighbours(
  order: readonly SwipeableSession[],
  asid: string | undefined
): SessionNeighbours {
  const index = asid ? order.findIndex((session) => session.asid === asid) : -1;
  if (index < 0) return { previous: undefined, next: undefined };
  return {
    previous: index > 0 ? order[index - 1].asid : undefined,
    next: index < order.length - 1 ? order[index + 1].asid : undefined,
  };
}

/**
 * The session one step in `direction`, or `undefined` at the end of the list.
 *
 * `previous` is the chip to the left and `next` the chip to the right, which is
 * the order the strip draws and therefore the only order a swipe can mean.
 */
export function neighbourSession(
  order: readonly SwipeableSession[],
  asid: string | undefined,
  direction: SessionSwipeDirection
): string | undefined {
  const neighbours = sessionNeighbours(order, asid);
  return direction === 'next' ? neighbours.next : neighbours.previous;
}

/**
 * The gesture's own numbers, in one object so the thresholds can be asserted in
 * a test rather than read off a chain of builder calls.
 *
 * `activeOffsetX` / `failOffsetY` are the pair that decides this pill's pan is
 * a *horizontal* gesture and nothing else. The pill sits in a floating header
 * over a scrolling transcript, so a drag that is mostly vertical has to reach
 * the list underneath rather than being swallowed here: past 10pt of vertical
 * travel the recogniser fails outright and the touch belongs to the scroll.
 * Sideways it waits for 12pt, which is far enough that a tap on the pill -- its
 * other, older job -- is never mistaken for the start of a swipe.
 *
 * Tighter than the terminal title's ±14 / ±24 on purpose: that pill sits over a
 * terminal grid that does not scroll vertically under the finger, so it can
 * afford to be greedier about a diagonal drag. This one cannot.
 */
export const SESSION_SWIPE = {
  /** Sideways travel before the pan takes the touch. */
  activeOffsetX: [-12, 12] as const,
  /** Vertical travel that hands the touch back to the transcript. */
  failOffsetY: [-10, 10] as const,
  /** Past this much horizontal travel, a release commits the switch. */
  distance: 44,
  /** ...or this much speed, for a flick that never travelled that far. */
  velocity: 420,
  /** How much of the finger's travel the pill's content takes. */
  followRatio: 1 / 3,
  /** ...and how far it may get regardless, as a fraction of the pill's width. */
  followLimitRatio: 0.4,
} as const;

/**
 * The direction a finished drag means, or `null` when it was not a horizontal
 * swipe at all. A worklet: this is called from the gesture's `onEnd`, on the UI
 * thread.
 *
 * `SESSION_SWIPE` is declared above it on purpose. A worklet's closure is
 * captured when the module is evaluated, so a constant declared *after* this
 * function reaches the UI thread as `undefined`, every comparison reads false,
 * and the swipe silently does nothing. Tests cannot see it: on the JS runtime
 * the same code resolves the constant at call time and passes. The terminal's
 * title swipe paid for this lesson once already; see `@/lib/workspace-cycle`.
 *
 * Distance or a flick either one counts -- a quick short swipe is the common
 * shape on a pill this small -- but a drag that travelled further vertically is
 * never a session switch, whatever its horizontal velocity was. `failOffsetY`
 * should already have stopped that drag from reaching here; this is the second
 * check, because the recogniser's offsets are about where a gesture *began*
 * going and this is about where it ended up.
 */
export function sessionSwipeDirection(
  translationX: number,
  translationY: number,
  velocityX: number
): SessionSwipeDirection | null {
  'worklet';
  const travelled = Math.abs(translationX) >= SESSION_SWIPE.distance;
  const flicked = Math.abs(velocityX) >= SESSION_SWIPE.velocity && Math.abs(translationX) >= 12;
  if (!travelled && !flicked) return null;
  if (Math.abs(translationX) < Math.abs(translationY)) return null;
  // Dragging left reveals what is to the right of the pill: the next session.
  return translationX < 0 ? 'next' : 'previous';
}

/**
 * How far the pill's content has got, for a live drag.
 *
 * Damped to a third and clamped to 40% of the pill, so the title never leaves
 * the chrome it is drawn in: the drag says "this is a sideways gesture, and it
 * is going that way", which does not need the full travel to say. A worklet,
 * for the same reason as above.
 *
 * A direction with no session on the far side is damped again -- a quarter of
 * an already-damped third -- so dragging off the end of the list gives a little
 * and refuses, the way a scroll view does at its own end. Nothing is announced
 * and nothing commits; the pill simply will not go.
 */
export function sessionSwipeFollow(
  translationX: number,
  pillWidth: number,
  hasNeighbour: boolean
): number {
  'worklet';
  const limit = pillWidth * SESSION_SWIPE.followLimitRatio;
  const followed = translationX * SESSION_SWIPE.followRatio * (hasNeighbour ? 1 : 0.25);
  return Math.max(-limit, Math.min(limit, followed));
}

/**
 * The screen-reader actions the pill offers, and the direction each means.
 *
 * `increment` / `decrement` rather than two custom action names: they are the
 * platform's own vocabulary for "one step along", which both TalkBack and
 * VoiceOver already announce and bind to a gesture the reader knows. A custom
 * name would be read out verbatim and have to be learned.
 *
 * The mapping lives here so it is asserted by a test rather than only by
 * inspecting a running app: the actions are the only route to this feature for
 * someone who cannot make the gesture, and a swap of the two would be invisible
 * to everyone who can.
 */
export const SESSION_SWIPE_ACTIONS = {
  increment: 'next',
  decrement: 'previous',
} as const satisfies Record<string, SessionSwipeDirection>;

/** The direction an accessibility action means, or `null` for any other. */
export function sessionSwipeActionDirection(actionName: string): SessionSwipeDirection | null {
  if (actionName === 'increment') return SESSION_SWIPE_ACTIONS.increment;
  if (actionName === 'decrement') return SESSION_SWIPE_ACTIONS.decrement;
  return null;
}
