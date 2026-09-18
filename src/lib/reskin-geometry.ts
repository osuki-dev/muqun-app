import type { ReskinPoint, ReskinSize } from './reskin-shaders';

/**
 * Where the re-skin transitions travel, and whether they run at all.
 *
 * Everything here is arithmetic on numbers: no Skia, no Reanimated, no React.
 * That is deliberate and it is not merely tidiness -- `src/lib/motion.ts`
 * cannot be imported under `bun test` because it reaches Reanimated, which
 * reaches React Native, which does not parse outside Metro. A module that
 * decides whether an effect runs is exactly the module that should be tested
 * without a device, so the decisions live here and the durations live there.
 */

/**
 * How long the app will wait for a picture of the old screen before giving up
 * on the transition, in milliseconds.
 *
 * The transition is an account of a change, never a precondition for one. A
 * reader who taps "Apply" and waits a fifth of a second for a photograph has
 * been given a slower app in exchange for a nicer animation, which is a bad
 * trade at any frame rate. Past this the apply happens with no effect at all
 * and nobody is told, because there is nothing the reader could do about it.
 *
 * 120 ms is a little under two frames of the budget a 16 ms device has for
 * eight -- long enough that a warm `makeImageFromView` always lands inside it,
 * short enough that a cold one does not become a stutter the reader reads as
 * the setting being slow to take.
 */
export const SNAPSHOT_BUDGET_MS = 120;

/**
 * How far past the far corner the front travels by the end of the run.
 *
 * Both transitions are driven by the design system's ease-out, which is the
 * right curve for something arriving and the wrong one for something leaving:
 * it decelerates into the end, so a front that finished exactly at the far
 * corner would spend the last beats of the run crawling off the screen with
 * one corner of the old interface still showing. Sending it a little past the
 * corner means the screen is clear before the curve has finished flattening.
 *
 * Kept small on purpose. Every percent of overshoot is a fraction of the run
 * in which nothing visible happens, and a transition with dead air at the end
 * reads as lag rather than as poise.
 */
export const FRONT_OVERSHOOT = 1.08;

/**
 * The fraction of a font's size that its x-height occupies, near enough.
 *
 * Real x-height is a per-face metric and the app cannot read one for a font it
 * has just been handed. It does not need to: this number decides how big a
 * halftone dot is, and the difference between a true x-height and half the em
 * is a dot a pixel wider. What matters is that the cell is on the order of the
 * lowercase letters being re-set, which is what makes the effect specific to a
 * typeface change rather than a decoration that could have gone anywhere.
 */
export const X_HEIGHT_RATIO = 0.52;

/** The smallest and largest halftone cell, in points. */
const CELL_MIN = 6;
const CELL_MAX = 14;

/** The halftone cell for a body text size, in points. */
export function halftoneCell(bodyFontSize: number): number {
  const cell = bodyFontSize * X_HEIGHT_RATIO;
  if (!Number.isFinite(cell)) return CELL_MIN;
  return Math.min(CELL_MAX, Math.max(CELL_MIN, cell));
}

/** The four corners of a screen, in canvas points. */
function corners(size: ReskinSize): ReskinPoint[] {
  return [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: 0, y: size.height },
    { x: size.width, y: size.height },
  ];
}

/**
 * The origin a transition actually uses, given what the caller knew, as a
 * fraction of the surface rather than as a point on it.
 *
 * Fractions, and this is the one genuinely surprising decision in the module,
 * so here is the reason. A re-skin can be playing on two surfaces at once: the
 * app behind, and a native form sheet in front of it. On Android that sheet is
 * a `Dialog` with a `Window` of its own, so a point measured inside it is in a
 * different coordinate space from the same point measured in the app -- there
 * is no offset that relates them, and asking either one for the other's
 * geometry gets a plausible-looking wrong answer. A fraction survives the
 * crossing: a row seven tenths of the way down the sheet is seven tenths of
 * the way down the screen, and both surfaces put the origin somewhere the
 * reader recognises as where they touched.
 *
 * A caller that measured the row the reader tapped passes its fraction. A
 * caller that could not -- a theme applied from a menu, a font reset that was
 * not a row -- passes nothing, and gets the default for its kind: the wash
 * comes in from the top-left corner, which is where a page starts, and the
 * halftone opens from the middle, which is where the reader is looking when
 * they did not touch a row to get here.
 *
 * An origin outside the surface is clamped rather than rejected: a row can be
 * measured while it is scrolling out of view, and a wash that comes from just
 * off the bottom is still the wash the reader asked for.
 */
export function resolveOrigin(
  origin: ReskinPoint | undefined,
  kind: 'theme' | 'font'
): ReskinPoint {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    return kind === 'theme' ? { x: 0, y: 0 } : { x: 0.5, y: 0.5 };
  }
  return {
    x: Math.min(1, Math.max(0, origin.x)),
    y: Math.min(1, Math.max(0, origin.y)),
  };
}

/**
 * A point measured on a surface, as the fraction of it that {@link resolveOrigin}
 * wants. For a caller that has a row's rectangle: pass its centre.
 */
export function normalizeOrigin(point: ReskinPoint, size: ReskinSize): ReskinPoint {
  if (!(size.width > 0) || !(size.height > 0)) return { x: 0.5, y: 0.5 };
  return resolveOrigin({ x: point.x / size.width, y: point.y / size.height }, 'font');
}

/** And back again, onto a particular surface, in that surface's own points. */
export function denormalizeOrigin(origin: ReskinPoint, size: ReskinSize): ReskinPoint {
  return { x: origin.x * size.width, y: origin.y * size.height };
}

/** Where the wash's front starts, where it ends, and which way it goes. */
export type WashGeometry = {
  /** Unit vector along the travel. */
  direction: ReskinPoint;
  /** The projection at which the screen is entirely still covered. */
  from: number;
  /** The projection at which it is entirely uncovered. */
  to: number;
};

/**
 * The wash's travel, from the point the reader touched.
 *
 * The direction is the one that takes the front from the origin to the corner
 * furthest from it, which is how the tapped row picks the angle: a row low on
 * the screen sends the wash upward, a row near the top sends it down, and an
 * origin at the top-left corner gives the plain top-left-to-bottom-right
 * diagonal that a caller with nothing to measure gets by default.
 *
 * The *start* is then the near extremity of that travel, not the origin
 * itself. This is worth being clear about, because it is the one place the
 * geometry does not do the naive thing: a front is a straight line, so if it
 * began at the origin every pixel behind the origin would already be uncovered
 * on the first frame -- a band of the new interface flashing into view before
 * the transition has started, which is precisely what the transition exists to
 * prevent. Starting at the near corner means the front enters from the screen
 * edge on the reader's side and crosses the row they touched a beat later, so
 * the wash still reads as coming from their finger while the first frame is
 * honestly the old screen and nothing else.
 *
 * `bleed` widens both ends by however far the noise can displace the front, so
 * the displaced edge cannot be caught poking past either extremity.
 */
export function washGeometry(origin: ReskinPoint, size: ReskinSize, bleed: number): WashGeometry {
  const points = corners(size);
  let far = points[0] as ReskinPoint;
  let farDistance = -1;
  for (const corner of points) {
    const distance = Math.hypot(corner.x - origin.x, corner.y - origin.y);
    if (distance > farDistance) {
      farDistance = distance;
      far = corner;
    }
  }

  // A zero-sized screen has no corner that is further away than any other, and
  // a zero-length direction would make the program divide by nothing. Down is
  // as good as any other answer for a canvas nobody can see.
  const dx = far.x - origin.x;
  const dy = far.y - origin.y;
  const length = Math.hypot(dx, dy);
  const direction = length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: 1 };

  let from = Infinity;
  let to = -Infinity;
  for (const corner of points) {
    const projection = (corner.x - origin.x) * direction.x + (corner.y - origin.y) * direction.y;
    from = Math.min(from, projection);
    to = Math.max(to, projection);
  }

  return { direction, from: from - bleed, to: to + bleed };
}

/** How far along the travel the wash's front has reached, at a progress. */
export function washFront(progress: number, geometry: WashGeometry): number {
  'worklet';
  return geometry.from + (geometry.to - geometry.from) * FRONT_OVERSHOOT * progress;
}

/** How far out the halftone's wave has to reach before the page is gone. */
export function halftoneReach(
  origin: ReskinPoint,
  size: ReskinSize,
  cell: number,
  band: number
): number {
  // Measured in screen space although the program measures it rotated by 45
  // degrees: a rotation about the origin preserves distance from that origin,
  // so the two are the same number and this one needs no trigonometry.
  let farthest = 0;
  for (const corner of corners(size)) {
    farthest = Math.max(farthest, Math.hypot(corner.x - origin.x, corner.y - origin.y));
  }
  // The furthest *cell centre* can sit half a diagonal beyond the furthest
  // corner, and that cell is not finished until the band has passed it too.
  return farthest + cell * Math.SQRT1_2 + band;
}

/** How far out the halftone's wave has reached, at a progress. */
export function halftoneFront(progress: number, reach: number): number {
  'worklet';
  return reach * FRONT_OVERSHOOT * progress;
}

/** What the app is going to do about a re-skin. */
export type ReskinPlay = 'wash' | 'halftone' | 'crossfade' | 'none';

/** How taking the picture went. */
export type SnapshotOutcome = 'ok' | 'failed' | 'slow';

/** Everything that decides which transition runs, if any. */
export type ReskinConditions = {
  kind: 'theme' | 'font';
  /** The device has asked for reduced motion. */
  reduceMotion: boolean;
  /** This kind's runtime effect compiled on this device. */
  effectReady: boolean;
  snapshot: SnapshotOutcome;
  size: ReskinSize;
};

/**
 * Which transition to play, or none.
 *
 * The order of these tests is the order of the reasons, and the first one is
 * the important one: without a photograph of the old screen there is nothing
 * to erase, so there is no transition to have an opinion about. That case
 * covers the device that cannot snapshot at all, and the device that could but
 * took too long -- see {@link SNAPSHOT_BUDGET_MS} for why those two get the
 * same answer.
 *
 * Reduced motion is answered with a cross-fade rather than with nothing,
 * because the setting asks for less movement, not for less continuity: a hard
 * cut between two entire colour schemes is the most violent thing this code
 * could do, and it is what "no animation" would produce. A two-hundred
 * millisecond dissolve has no travel in it at all and still spares the reader
 * the cut.
 *
 * A device whose shader would not compile gets the same cross-fade for the
 * same reason -- the picture is already taken, and a dissolve is the part of
 * the effect that needs no GPU program.
 */
export function selectReskinPlay(conditions: ReskinConditions): ReskinPlay {
  const { size } = conditions;
  if (conditions.snapshot !== 'ok') return 'none';
  if (!(size.width > 0) || !(size.height > 0)) return 'none';
  if (conditions.reduceMotion) return 'crossfade';
  if (!conditions.effectReady) return 'crossfade';
  return conditions.kind === 'theme' ? 'wash' : 'halftone';
}

/** Whether a snapshot that took this long is still worth using. */
export function snapshotOutcome(image: unknown, elapsedMs: number): SnapshotOutcome {
  if (!image) return 'failed';
  return elapsedMs > SNAPSHOT_BUDGET_MS ? 'slow' : 'ok';
}
