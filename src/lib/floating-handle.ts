/**
 * Where a floating handle comes to rest.
 *
 * The editor's collapsed control is the one piece of chrome left over a
 * full-screen program, and the reader moves it for exactly one reason: it is
 * standing on the line they are reading. So it follows the finger in both
 * axes -- AssistiveTouch, a chat head, a picture-in-picture window -- and the
 * only question this file answers is where it goes when the finger lifts.
 *
 * It goes to an edge. A control released in the middle of the pane is a
 * control sitting on the text, which is the state the drag existed to get out
 * of; parking it against the left or the right rail costs the file one column
 * instead of a hole in the middle of it. The vertical is left exactly where
 * the reader put it, because that is the axis they were actually aiming with.
 *
 * Pure and free of Reanimated so the rule is a table in a test rather than
 * three clamps inside a worklet. The gesture supplies the numbers; this
 * decides the answer; `settleTo` carries the value there.
 */

/** The rectangle of offsets the handle may rest at, in points. */
export interface HandleBounds {
  /** Left rail. Negative, because the handle is anchored to the right one. */
  minX: number;
  /** Right rail, which is the anchor itself: zero unless the pane is tiny. */
  maxX: number;
  /** As high as the handle may go -- negative, and clear of the header. */
  minY: number;
  /** As low as it may go, clear of the bottom safe area. */
  maxY: number;
}

/** A point in the same offset space. */
export interface HandlePoint {
  x: number;
  y: number;
}

/**
 * How much of the release velocity, in seconds, the throw is projected over.
 *
 * Not a duration -- it is the horizon the flick is aimed at, and only the edge
 * it picks out matters, because the spring lands on a rail either way. Enough
 * that a deliberate flick across the pane crosses the midpoint, small enough
 * that letting go while barely moving does not.
 */
export const FLING_PROJECTION_S = 0.12;

function clamp(value: number, low: number, high: number): number {
  'worklet';
  return Math.min(high, Math.max(low, value));
}

/**
 * The rest point for a release: the nearer rail, or the one the throw was
 * heading for.
 *
 * A slow release goes to whichever rail is closer to the finger. A flick is
 * projected forward first, so a handle thrown from the left half to the right
 * lands on the right even though it never got past the middle -- which is what
 * "the edge it was heading for" means and what a plain nearest-edge test gets
 * wrong on every fast gesture.
 */
export function snapFloatingHandle(
  release: HandlePoint & { velocityX?: number },
  bounds: HandleBounds
): HandlePoint {
  'worklet';
  const projected = clamp(
    release.x + (release.velocityX ?? 0) * FLING_PROJECTION_S,
    bounds.minX,
    bounds.maxX
  );
  const middle = (bounds.minX + bounds.maxX) / 2;
  return {
    x: projected < middle ? bounds.minX : bounds.maxX,
    y: clamp(release.y, bounds.minY, bounds.maxY),
  };
}

/**
 * The four rest positions, in the order the accessibility action walks them.
 *
 * Clockwise from the top left, which is the order a reader describes a screen
 * in. Someone who cannot make the drag gesture gets the same four places a
 * drag can leave the handle, one action at a time.
 */
export function handleCorners(bounds: HandleBounds): HandlePoint[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/**
 * The next corner round from wherever the handle is now.
 *
 * "Wherever it is now" is the nearest corner rather than an index held
 * somewhere: the handle can also be dragged, and an action that continued from
 * a remembered step would send it back across the pane it was just moved off.
 */
export function nextHandleCorner(from: HandlePoint, bounds: HandleBounds): HandlePoint {
  const corners = handleCorners(bounds);
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  for (const [index, corner] of corners.entries()) {
    const distance = (corner.x - from.x) ** 2 + (corner.y - from.y) ** 2;
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  }
  return corners[(nearest + 1) % corners.length];
}

/**
 * Keeps a remembered position inside bounds that have changed under it.
 *
 * A rotation, a text-size change, a pane that grew: the offset the reader left
 * is measured against a rectangle that no longer exists. Which rail the handle
 * was on is read off the bounds it was resting in rather than off the new
 * ones, because those are two different answers -- on a screen that got wider,
 * an offset that was the left rail is nearer the right one, and a handle the
 * reader parked on the left would cross the pane on a rotation.
 */
export function reseatFloatingHandle(
  at: HandlePoint,
  from: HandleBounds,
  to: HandleBounds
): HandlePoint {
  'worklet';
  const wasLeft = at.x < (from.minX + from.maxX) / 2;
  return { x: wasLeft ? to.minX : to.maxX, y: clamp(at.y, to.minY, to.maxY) };
}
