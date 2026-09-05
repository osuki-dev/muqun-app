/**
 * Where the simulator's picture is drawn, and which pixel of it a finger hit.
 *
 * Two questions, one file, because they are the same arithmetic read in
 * opposite directions. Getting the first one wrong makes the device small; only
 * getting the second one wrong *in the same way* makes it small and unusable,
 * which is the state this replaced -- so the placement a touch is resolved
 * against is the placement that was drawn, by construction, and never a second
 * copy of the sum.
 *
 * ## The fit rule
 *
 * **A portrait viewport fills its width. A landscape one fills its height.**
 *
 * The rule this replaced was simfarm's own, and it was written for a window on
 * a desk: reserve a 72px rail column, 24px of margin and a 56px pill row, then
 * take the largest of 50% / 75% / 100% that still fits. Measured on the phone
 * this was reported from -- a 402x812pt sheet showing a 402x874pt iPhone -- that
 * ladder lands on 50%: a 201pt-wide picture with 375pt of empty background
 * above and below it, and type nobody can read. There is nothing to reserve
 * here. The whole surface belongs to the picture.
 *
 * Filling the width means a device taller than the surface hangs over its ends,
 * which is why `clampOffset` and a two-finger drag exist. That is the trade the
 * report asked for and it is the right way round: the reader came to look at
 * the app, and the 7% of a phone that is status bar and home indicator is the
 * part they can reach for when they want it.
 *
 * The landscape half is not symmetry for its own sake. On a Pad, or a phone
 * turned sideways, filling the width with an upright phone would put a picture
 * three screens tall in front of someone -- so the short side wins there, which
 * is the same sentence as "the binding dimension wins" with the axes swapped.
 *
 * ## Why it is pure
 *
 * Because the failure it prevents is silent. A frame drawn at the wrong scale
 * looks like a design choice; a touch mapped through the wrong rectangle looks
 * like a tap that did nothing, which is exactly what was reported. Neither
 * announces itself, and neither needs a device to test.
 */
import { type SimfarmEdge } from '@/lib/simfarm-protocol';

export interface SimfarmSize {
  width: number;
  height: number;
}

export interface SimfarmPoint {
  x: number;
  y: number;
}

/** Where the picture ended up, in the surface's own coordinates. */
export interface SimfarmPlacement extends SimfarmSize, SimfarmPoint {
  /** Surface units per frame unit, fit and zoom together. */
  scale: number;
}

/**
 * How far in the reader may zoom past the fit.
 *
 * 1 is the floor because below the fit there would be background on every side
 * again, which is the thing being fixed. 4 is where an iPhone's 402pt reaches
 * about four times life size -- past that a pinch is scrolling around a blur.
 */
export const SIMFARM_MIN_ZOOM = 1;
export const SIMFARM_MAX_ZOOM = 4;

/**
 * How close to an edge a gesture has to start to be an edge gesture, as a
 * fraction of the picture.
 *
 * iOS's own system gestures start within about 20pt of an edge; on a 402pt-wide
 * phone that is 5%, and the same fraction on the long side is a little under
 * 20pt. One number for both axes is close enough to the real behaviour and far
 * easier to reason about than two.
 */
export const SIMFARM_EDGE_BAND = 0.05;

/**
 * The scale at which the picture fills the surface: width in portrait, height
 * in landscape. See the note above for why it is not `min` of the two.
 */
export function simfarmFitScale(frame: SimfarmSize, viewport: SimfarmSize): number {
  if (frame.width <= 0 || frame.height <= 0) return 1;
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return viewport.height >= viewport.width
    ? viewport.width / frame.width
    : viewport.height / frame.height;
}

/**
 * The offset a pan may actually hold.
 *
 * An axis with room to spare is pinned to nothing -- the picture is centred on
 * it and a drag there would only slide it into a margin it does not have. An
 * axis that overflows may move by exactly the overflow, half of it either way
 * from centre, so both ends stay reachable and neither can be dragged past.
 */
export function clampSimfarmOffset(
  content: SimfarmSize,
  viewport: SimfarmSize,
  offset: SimfarmPoint
): SimfarmPoint {
  const limitX = Math.max(0, (content.width - viewport.width) / 2);
  const limitY = Math.max(0, (content.height - viewport.height) / 2);
  return {
    x: clamp(offset.x, -limitX, limitX),
    y: clamp(offset.y, -limitY, limitY),
  };
}

/**
 * Where to draw `frame` on a `viewport`, at `zoom` times the fit, panned by
 * `offset`.
 *
 * The single source of truth for both the drawing and the touch mapping. A
 * caller that computed either of them separately would be one refactor away
 * from a preview whose taps land somewhere else, which is the defect this
 * whole change is about.
 */
export function placeSimfarmFrame(
  frame: SimfarmSize,
  viewport: SimfarmSize,
  zoom = 1,
  offset: SimfarmPoint = { x: 0, y: 0 }
): SimfarmPlacement {
  const scale = simfarmFitScale(frame, viewport) * clamp(zoom, SIMFARM_MIN_ZOOM, SIMFARM_MAX_ZOOM);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const panned = clampSimfarmOffset({ width, height }, viewport, offset);
  return {
    width,
    height,
    x: (viewport.width - width) / 2 + panned.x,
    y: (viewport.height - height) / 2 + panned.y,
    scale,
  };
}

/**
 * A point on the surface as a fraction of the picture, which is the only
 * coordinate system the protocol has.
 *
 * Clamped rather than rejected. The server clamps too, but a touch that began
 * on the picture and ended past its edge is a real gesture -- a swipe up from
 * the bottom of a device drawn taller than the surface is exactly that -- and
 * ending it at the edge keeps it a gesture instead of dropping the finish and
 * leaving the device holding a touch that never lifted.
 */
export function simfarmNormalizedPoint(
  point: SimfarmPoint,
  placement: SimfarmPlacement
): SimfarmPoint {
  if (placement.width <= 0 || placement.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((point.x - placement.x) / placement.width),
    y: clamp01((point.y - placement.y) / placement.height),
  };
}

/**
 * Which edge, if any, a gesture starting here counts as coming from.
 *
 * Taken once, from the `begin` point, and then carried unchanged for the rest
 * of the gesture -- see `SIMFARM_EDGE` for why the server cannot work it out
 * later. Corners resolve to the nearer edge rather than to two, because the
 * wire has one byte for it and a device has one gesture for it.
 */
export function simfarmEdgeAt(point: SimfarmPoint, band = SIMFARM_EDGE_BAND): SimfarmEdge {
  const distances: [SimfarmEdge, number][] = [
    ['top', point.y],
    ['bottom', 1 - point.y],
    ['left', point.x],
    ['right', 1 - point.x],
  ];
  let nearest: SimfarmEdge = 'none';
  let best = band;
  for (const [edge, distance] of distances) {
    if (distance <= best) {
      best = distance;
      nearest = edge;
    }
  }
  return nearest;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
