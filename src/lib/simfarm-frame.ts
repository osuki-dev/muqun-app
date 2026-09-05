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

/** The band on each axis, as fractions of the picture's width and height. */
export interface SimfarmEdgeBands {
  x: number;
  y: number;
}

/**
 * How far in from the sides a gesture may start and still be the device's
 * edge gesture, in the viewer's own points, on a viewer that has edge
 * gestures of its own.
 *
 * Android takes the outermost strip of the screen for its back gesture --
 * 24dp by default, more when the reader has widened it in Settings -- and a
 * touch that starts there never reaches the app. Measured on the emulator:
 * with the system bars hidden, the strip's swipe reveals them instead of
 * going back, and either way the picture sees nothing. So on Android the
 * device's left and right edge bands begin where the system's strip ends
 * and reach this far in, so that a swipe "a little inside the edge" is still
 * sent with the edge byte and the simulator still treats it as one -- iOS's
 * HID edge hint is what makes that work, not the exact x. The top and bottom
 * keep the 5% band: the system owns nothing there once the bars are hidden.
 */
export const SIMFARM_ANDROID_EDGE_REACH = 40;

/**
 * The bands for a viewer, given what it is and how wide the picture is drawn.
 *
 * iOS viewers keep the one fraction on both axes. Android viewers get a
 * horizontal band wide enough to clear the system's back-gesture strip; it is
 * never narrower than the fraction, so a wide picture on a Pad-sized screen
 * does not end up with an edge thinner than a finger.
 */
export function simfarmEdgeBands(
  platform: 'android' | 'ios' | (string & {}),
  pictureWidth: number
): SimfarmEdgeBands {
  if (platform !== 'android' || !(pictureWidth > 0)) {
    return { x: SIMFARM_EDGE_BAND, y: SIMFARM_EDGE_BAND };
  }
  return {
    x: Math.max(SIMFARM_EDGE_BAND, SIMFARM_ANDROID_EDGE_REACH / pictureWidth),
    y: SIMFARM_EDGE_BAND,
  };
}

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
/**
 * Where an untouched picture rests: centred, unless it is taller than the
 * viewport, in which case it starts at the top of it.
 *
 * `placeSimfarmFrame` centres, and centring a phone that hangs over both ends
 * puts its top half-an-overflow above the viewport. On a sheet that was fine.
 * Full screen, the viewport starts under the camera cutout, and a picture
 * that began above it had its status bar behind the Dynamic Island -- so the
 * overflow is hung off the bottom instead, where the key row is anyway, and
 * the two-finger drag reveals it. The horizontal is always centred: the fit
 * rule fills the width, so there is nothing to hang until the reader zooms.
 *
 * The answer is an offset in `clampSimfarmOffset`'s terms, so it is exactly
 * the value the pan would have reached by dragging to the top, and the clamp
 * can never disagree with it.
 */
export function simfarmRestingOffset(
  frame: SimfarmSize,
  viewport: SimfarmSize,
  zoom = 1
): SimfarmPoint {
  const scale = simfarmFitScale(frame, viewport) * clamp(zoom, SIMFARM_MIN_ZOOM, SIMFARM_MAX_ZOOM);
  return { x: 0, y: Math.max(0, (frame.height * scale - viewport.height) / 2) };
}

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
export function simfarmEdgeAt(
  point: SimfarmPoint,
  band: number | SimfarmEdgeBands = SIMFARM_EDGE_BAND
): SimfarmEdge {
  const bands = typeof band === 'number' ? { x: band, y: band } : band;
  // Each distance measured against its own band, so the nearer edge wins by
  // how deep into its band the point is rather than by raw distance -- a
  // wide side band must not steal a corner from a thin top one.
  const depths: [SimfarmEdge, number][] = [
    ['top', point.y / bands.y],
    ['bottom', (1 - point.y) / bands.y],
    ['left', point.x / bands.x],
    ['right', (1 - point.x) / bands.x],
  ];
  let nearest: SimfarmEdge = 'none';
  let best = 1;
  for (const [edge, depth] of depths) {
    if (depth <= best) {
      best = depth;
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
