/**
 * One rectangle for both the simulator image and its normalized input.
 * The initial view contains the entire device. Two-finger zoom and pan reveal
 * detail; restoring zoom 1 returns to the complete view.
 */
import { type SimfarmEdge } from '@/lib/simfarm-protocol';

/**
 * The two clamps, ahead of everything that uses them: they run on the UI
 * runtime too, and a worklet captures what it calls when it is made, which
 * for a module-level function is module evaluation -- a helper declared
 * further down the file is `undefined` at that moment.
 */
function clamp(value: number, low: number, high: number): number {
  'worklet';
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

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
 * 1 contains the complete device. 4 allows detail inspection without an
 * unbounded image that is difficult to navigate back from.
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

/** Scale to show the whole device, including a landscape tablet on a phone. */
export function simfarmFitScale(frame: SimfarmSize, viewport: SimfarmSize): number {
  'worklet';
  if (frame.width <= 0 || frame.height <= 0) return 1;
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(viewport.width / frame.width, viewport.height / frame.height);
}

/**
 * The offset a pan may actually hold.
 *
 * An axis with room to spare is pinned to nothing -- a drag there would only
 * slide the picture into a margin it does not have. An axis that overflows
 * may move by exactly the overflow, half of it either way from centre, so
 * both ends stay reachable and neither can be dragged past.
 */
export function clampSimfarmOffset(
  content: SimfarmSize,
  viewport: SimfarmSize,
  offset: SimfarmPoint
): SimfarmPoint {
  'worklet';
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
 *
 * Fitted images are centered. Enlarged images pan within their overflow.
 */
export function placeSimfarmFrame(
  frame: SimfarmSize,
  viewport: SimfarmSize,
  zoom = 1,
  offset: SimfarmPoint = { x: 0, y: 0 }
): SimfarmPlacement {
  'worklet';
  const scale = simfarmFitScale(frame, viewport) * clamp(zoom, SIMFARM_MIN_ZOOM, SIMFARM_MAX_ZOOM);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const panned = clampSimfarmOffset({ width, height }, viewport, offset);
  const centred = (viewport.height - height) / 2 + panned.y;
  return {
    width,
    height,
    x: (viewport.width - width) / 2 + panned.x,
    y: centred,
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
/** Enlarged images start at the top; the complete fitted image is centered. */
export function simfarmRestingOffset(
  frame: SimfarmSize,
  viewport: SimfarmSize,
  zoom = 1
): SimfarmPoint {
  'worklet';
  const scale = simfarmFitScale(frame, viewport) * clamp(zoom, SIMFARM_MIN_ZOOM, SIMFARM_MAX_ZOOM);
  return { x: 0, y: Math.max(0, (frame.height * scale - viewport.height) / 2) };
}

/** Black margins belong to the viewer; only a gesture starting on the image is forwarded. */
export function simfarmContainsPoint(point: SimfarmPoint, placement: SimfarmPlacement): boolean {
  return (
    point.x >= placement.x &&
    point.x <= placement.x + placement.width &&
    point.y >= placement.y &&
    point.y <= placement.y + placement.height
  );
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
