/**
 * Where a swiped in-app notice goes when the finger lifts.
 *
 * The banner is the one piece of chrome that arrives uninvited, over whatever
 * the reader was already doing, so the way past it should be the way past a
 * notification anywhere else: push it off the top edge, or sweep it aside.
 * Only one direction is refused -- downward. The deck's other pages peek out
 * below the front plate, and a downward drag is how a reader reaches for them;
 * a dismissal that also started there would be two meanings on one stroke.
 *
 * Pure and free of Reanimated and gesture-handler, for the same reason
 * `floating-handle.ts` is: the rule is then a table in a test rather than
 * three comparisons buried in a worklet. The gesture supplies the numbers,
 * this decides the answer, and `settleTo` carries the value where it says.
 */

/**
 * How much of the finger's travel the plate actually makes.
 *
 * Not 1, and not far from it. A banner pinned exactly to the touch reads as a
 * loose object; a banner at half speed reads as a stuck one. The eighth the
 * plate holds back is felt as the surface having some weight without ever
 * looking like it is disobeying.
 */
export const NOTICE_DRAG_FOLLOW = 0.88;

/**
 * How far up the plate travels before the lift throws it away, in points.
 *
 * A short stroke. It was a third of the plate's height, and the owner's
 * verdict on a device was that the banner had to be dragged away rather than
 * brushed away. The gesture only claims touches that start on the plate and
 * have already cleared its activation slop, so a small distance here cannot be
 * a scroll of the screen underneath.
 */
export const NOTICE_DISMISS_RISE = 18;

/**
 * How far sideways, as a fraction of the plate's width.
 *
 * A fraction rather than a number of points because the plate is as wide as
 * the screen less its margins, and "a tenth of the way across" is the same
 * gesture on a phone and on a tablet.
 */
export const NOTICE_DISMISS_SWEEP_RATIO = 0.1;

/** The narrowest the sideways threshold may become on a small screen. */
export const NOTICE_DISMISS_SWEEP_MIN = 28;

/**
 * The speed, in points per second, at which a stroke is a throw.
 *
 * Above it the distance stops mattering: a fast flick is a decision, and
 * holding it to the full distance would make the app feel like it had not
 * noticed. `MOVED` is the floor that keeps a tap with a trembling finger from
 * registering as a throw of its own.
 */
export const NOTICE_DISMISS_VELOCITY = 350;

/** Travel below which a stroke is not a stroke at all, in points. */
export const NOTICE_DISMISS_MOVED = 6;

/** How far past the edge a dismissed plate is sent, in points. */
export const NOTICE_DISMISS_OVERSHOOT = 64;

/** What the finger did, in the gesture's own numbers. */
export interface NoticeSwipe {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
}

/** The plate being swiped, as it was last measured. */
export interface NoticePlate {
  width: number;
  height: number;
}

/** Where the plate sits mid-drag, as a translation off its resting place. */
export interface NoticeOffset {
  x: number;
  y: number;
}

/**
 * Either the plate springs home, or it leaves in a named direction.
 *
 * The target is carried rather than left to the caller so that the flight and
 * the decision cannot disagree about which edge the notice went out of.
 */
export type NoticeSwipeEnd = { dismissed: false } | { dismissed: true; x: number; y: number };

/**
 * Where the plate is drawn for a finger that has travelled this far.
 *
 * Downward is pinned to zero rather than resisted: the gesture is configured
 * not to activate on a downward stroke at all, and this is what keeps the
 * plate still if one arrives anyway -- a finger that went up, dismissed
 * nothing, and came back down past where it started.
 */
export function noticeDragOffset(swipe: Pick<NoticeSwipe, 'translationX' | 'translationY'>) {
  'worklet';
  return {
    x: swipe.translationX * NOTICE_DRAG_FOLLOW,
    y: Math.min(0, swipe.translationY) * NOTICE_DRAG_FOLLOW,
  };
}

/**
 * Whether this stroke was a dismissal, and if so which way the plate leaves.
 *
 * Distance or speed, in either axis, and the axis that got furthest through
 * its own threshold wins a stroke that crossed both -- a diagonal flick then
 * leaves the way it was mostly going, rather than the way the code happened to
 * check first.
 */
export function noticeSwipeEnd(swipe: NoticeSwipe, plate: NoticePlate): NoticeSwipeEnd {
  'worklet';
  const offset = noticeDragOffset(swipe);
  const sweep = Math.max(NOTICE_DISMISS_SWEEP_MIN, plate.width * NOTICE_DISMISS_SWEEP_RATIO);
  const moved = Math.abs(offset.x) >= NOTICE_DISMISS_MOVED;
  const rose = -offset.y >= NOTICE_DISMISS_MOVED;

  // Progress through each axis' own threshold, so the two are comparable.
  const across =
    Math.abs(offset.x) >= sweep || (moved && Math.abs(swipe.velocityX) >= NOTICE_DISMISS_VELOCITY)
      ? Math.max(Math.abs(offset.x) / sweep, Math.abs(swipe.velocityX) / NOTICE_DISMISS_VELOCITY)
      : 0;
  const up =
    -offset.y >= NOTICE_DISMISS_RISE || (rose && -swipe.velocityY >= NOTICE_DISMISS_VELOCITY)
      ? Math.max(-offset.y / NOTICE_DISMISS_RISE, -swipe.velocityY / NOTICE_DISMISS_VELOCITY)
      : 0;

  if (across === 0 && up === 0) return { dismissed: false };
  if (across >= up) {
    const heading = swipe.velocityX === 0 ? offset.x : swipe.velocityX;
    const edge = plate.width + NOTICE_DISMISS_OVERSHOOT;
    return { dismissed: true, x: heading < 0 ? -edge : edge, y: offset.y };
  }
  return { dismissed: true, x: offset.x, y: -(plate.height + NOTICE_DISMISS_OVERSHOOT) };
}
