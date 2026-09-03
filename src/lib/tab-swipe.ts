/**
 * The two-finger swipe that cycles the current workspace's tabs, as pure
 * functions.
 *
 * Two things live here. The first is telling one two-finger gesture from the
 * other: the terminal already answers a pinch by zooming its canvas, so the
 * swipe has to be sure it is a swipe before it moves the reader somewhere else
 * entirely. The second is the ring itself -- which tab a direction lands on,
 * and which pane that tab should come back on.
 *
 * The screen owns the touches and the selection; everything it decides is here
 * so that the boundary cases -- a pinch that also drifted sideways, a swipe
 * with one finger dragging, a workspace with a single tab -- are covered by
 * tests rather than by two thumbs on a phone.
 */
import {
  canCycle,
  ringPosition,
  stepRing,
  stepRingFrom,
  type CycleDirection,
  type RingItem,
} from '@/lib/cycle-ring';

export type TabCycleDirection = CycleDirection;

/** Only what cycling reads, so tests need no gateway entity. */
export type CyclableTab = RingItem;

export type TabCycleTarget = {
  tabId: string;
  title: string;
  /** 1-based place in the ring. Read by the screen; not drawn on its own. */
  position: number;
  total: number;
};

/** Which pane each tab was last left on, keyed by tab id. */
export type TabPaneMemory = Record<string, string>;

/* ── Telling a swipe from a pinch ──────────────────────────────────────── */

/**
 * One finger, in whatever coordinates the caller measured both of them in.
 *
 * In the app that is `gesture-handler`'s own touch stream (`allTouches` on the
 * canvas's two-finger pan), because React Native's touch events never survive
 * the gesture that owns the canvas -- see `useTabSwipe`. Only differences
 * between two frames are ever taken, so view-local and screen coordinates are
 * equally good as long as one gesture stays in one of them.
 */
export type FingerPoint = {
  x: number;
  y: number;
};

/** Both fingers at one instant. */
export type TwoFingerFrame = {
  a: FingerPoint;
  b: FingerPoint;
};

/**
 * What a completed two-finger gesture was.
 *
 * `pinch` is reported rather than folded into `none` on purpose: the two mean
 * different things to the caller. A pinch has already been answered by the
 * canvas underneath and must pass in silence; `none` is a gesture that did not
 * reach any threshold, and is the case a future affordance would hang off.
 */
export type TwoFingerGesture = 'next' | 'previous' | 'pinch' | 'none';

/**
 * How far the pair has to travel sideways before it is a tab switch.
 *
 * Inherited from the two-finger swipe this replaces. It is deliberately much
 * further than the title pill's own 44: the pill is a small target a user aims
 * at, whereas this fires anywhere on a pane the same user pans and pinches all
 * day, and the cost of a false positive is the page they were reading.
 */
export const TAB_SWIPE_DISTANCE = 72;

/** A swipe has to be this much more horizontal than vertical to count. */
export const TAB_SWIPE_AXIS_BIAS = 1.35;

/**
 * How much of the pair's travel the slower finger has to do.
 *
 * "Two fingers moving together" is the whole premise, and a pair where one
 * finger is planted and the other sweeps past it is not that -- it is closer to
 * a rotation, and on a small screen it is usually a pinch performed clumsily.
 * At 0.5 the slower finger must cover at least half the average, which passes
 * every deliberate two-finger pan and rejects the anchored-finger shape.
 */
export const TAB_SWIPE_TOGETHER_SHARE = 0.5;

/**
 * How much the gap between the fingers has to change before the gesture is
 * considered a pinch at all.
 *
 * Below this it is the ordinary wobble of a two-finger pan: fingers are not a
 * rigid body and the gap breathes by a few points over a 100-point sweep. Above
 * it, whichever of the two motions is larger decides -- see `classify`.
 */
export const TAB_SWIPE_PINCH_SEPARATION = 24;

/**
 * How still the fingers have to be before a swipe is handed to the screen.
 *
 * The same number, and the same reasoning, as the workspace switch: long enough
 * that a burst of flicks is one landing rather than twenty -- the pane carousel
 * itself runs about 300 ms, so anything inside that window is still mid-gesture
 * -- and short enough that a single deliberate swipe reads as instant, which it
 * does anyway, because the indicator and the carousel have already moved.
 */
export const TAB_SWIPE_COMMIT_QUIET_MS = 320;

/**
 * Whether a swipe arriving at `now` is applied at once or waits for the
 * swiping to stop.
 *
 * The first swipe of a burst applies immediately, because a gesture that waited
 * a third of a second to do anything would read as a dropped one. Everything
 * after it waits, because landing on a tab reconciles the selection and reads a
 * new pane's output, and fingers flicking every 45 ms queue those faster than
 * they retire -- which is how the workspace switch reached an OutOfMemoryError
 * (card #608). A burst therefore costs two landings however long it runs.
 */
export function swipeAppliesImmediately(previousSwipeAt: number, now: number): boolean {
  return now - previousSwipeAt >= TAB_SWIPE_COMMIT_QUIET_MS;
}

function distance(from: FingerPoint, to: FingerPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * What a two-finger gesture between these two frames was.
 *
 * The judgement is between two quantities, and only these two:
 *
 *  * how far the *pair* moved -- the midpoint's travel, which is what both
 *    fingers did in common;
 *  * how much the *gap* between them changed -- which is what they did in
 *    opposition, and is exactly the quantity a pinch is made of.
 *
 * A pure pan changes the gap by nothing and the midpoint by a lot; a pure pinch
 * the reverse. Everything in between is decided by which is larger, so there is
 * no band where a gesture is both and no band where it is neither -- which is
 * what the old test (one finger's delta, `pointers >= 2`) got wrong: it could
 * not see the second finger at all, so a pinch whose fingers were not
 * symmetric about the focal point read as a swipe and moved the pane out from
 * under a reader who was only zooming.
 *
 * The remaining checks are the ordinary ones: far enough, sideways enough, and
 * both fingers actually going the same way.
 */
export function classifyTwoFingerGesture(
  from: TwoFingerFrame,
  to: TwoFingerFrame
): TwoFingerGesture {
  const deltaAX = to.a.x - from.a.x;
  const deltaBX = to.b.x - from.b.x;
  const shiftX = (deltaAX + deltaBX) / 2;
  const shiftY = (to.a.y - from.a.y + (to.b.y - from.b.y)) / 2;
  const separation = distance(to.a, to.b) - distance(from.a, from.b);

  // Opposition first. A gesture that changed the gap more than it moved the
  // pair is a pinch however far sideways it also drifted, and the canvas has
  // already zoomed for it.
  if (
    Math.abs(separation) >= TAB_SWIPE_PINCH_SEPARATION &&
    Math.abs(separation) > Math.abs(shiftX)
  ) {
    return 'pinch';
  }

  if (Math.abs(shiftX) < TAB_SWIPE_DISTANCE) return 'none';
  if (Math.abs(shiftX) < Math.abs(shiftY) * TAB_SWIPE_AXIS_BIAS) return 'none';
  // Same direction, and neither finger merely along for the ride. Stated
  // separately from the separation test above because it is the premise in its
  // own words: two fingers moving together. A pair that fails this has usually
  // already been called a pinch, but not always -- fingers stacked vertically
  // can shear past each other with the gap barely changing.
  if (Math.sign(deltaAX) !== Math.sign(deltaBX)) return 'none';
  if (
    Math.min(Math.abs(deltaAX), Math.abs(deltaBX)) <
    Math.abs(shiftX) * TAB_SWIPE_TOGETHER_SHARE
  ) {
    return 'none';
  }

  return shiftX < 0 ? 'next' : 'previous';
}

/**
 * The two fingers of a touch list, or `null` where there are not exactly two.
 *
 * Three fingers are not a tab swipe: the shape is ambiguous and nothing in the
 * app asks for one, so the safe answer is to ignore the whole gesture rather
 * than to guess which two of the three were meant.
 */
export function twoFingerFrame(
  touches: readonly { x: number; y: number }[]
): TwoFingerFrame | null {
  if (touches.length !== 2) return null;
  return {
    a: { x: touches[0].x, y: touches[0].y },
    b: { x: touches[1].x, y: touches[1].y },
  };
}

/* ── The ring of tabs ──────────────────────────────────────────────────── */

function asTabTarget(
  target: { id: string; title: string; position: number; total: number } | null
): TabCycleTarget | null {
  if (!target) return null;
  return { tabId: target.id, title: target.title, position: target.position, total: target.total };
}

/**
 * A workspace with one tab has nowhere to go. The gesture is not disabled the
 * way the title pill's is -- there is no separate detector to switch off, the
 * touches are the pane's own -- so the screen simply passes in silence: no
 * indicator, no haptic, no reload.
 */
export function canCycleTabs(tabs: CyclableTab[]): boolean {
  return canCycle(tabs);
}

/** Where the current tab sits, for the indicator. */
export function tabPosition(tabs: CyclableTab[], tabId: string): TabCycleTarget | null {
  return asTabTarget(ringPosition(tabs, tabId));
}

/** The tab one step in `direction`, wrapping at either end. */
export function cycleTab(
  tabs: CyclableTab[],
  tabId: string,
  direction: TabCycleDirection
): TabCycleTarget | null {
  return asTabTarget(stepRing(tabs, tabId, direction));
}

/**
 * Where the next swipe of a burst lands -- stepping from the tab the finger has
 * already reached rather than from the one the screen has caught up to. See
 * `stepRingFrom`; the reason this matters here is the same P0 the workspace
 * switch was fixed for, and the cost of getting it wrong is the same too.
 */
export function cycleTabFrom(
  tabs: CyclableTab[],
  committedId: string,
  pendingId: string | null,
  direction: TabCycleDirection
): TabCycleTarget | null {
  return asTabTarget(stepRingFrom(tabs, committedId, pendingId, direction));
}

/**
 * Record which pane a tab is being left on, so swiping back returns to it
 * rather than to whatever the gateway considers focused. A selection with no
 * pane is not worth remembering -- it would overwrite a good entry with the
 * blank moment between two loads.
 */
export function rememberTabPane(
  memory: TabPaneMemory,
  selection: { tabId: string; paneId: string }
): TabPaneMemory {
  if (!selection.tabId || !selection.paneId) return memory;
  if (memory[selection.tabId] === selection.paneId) return memory;
  return { ...memory, [selection.tabId]: selection.paneId };
}

/**
 * Which pane that tab was last left on, as a selection candidate. An empty pane
 * id where nothing is remembered, which the screen's own reconcile step then
 * fills in from the session -- so a remembered pane that has since been closed
 * falls back exactly the way a fresh visit would.
 */
export function recallTabPane(memory: TabPaneMemory, tabId: string): string {
  return memory[tabId] ?? '';
}
