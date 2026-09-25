/**
 * Where Home's hero picture actually lands inside its band, and how far in from
 * its edges it fades out.
 *
 * Two separate questions that have to be answered together, which is why they
 * share a module:
 *
 * 1. **Which rectangle does the image occupy?** The hero is always `contain`-fit
 *    inside a band whose height is a ceiling rather than a size, so a wide
 *    drawing in a tall band is letterboxed and a tall one is pillarboxed. The
 *    empty space that leaves is not part of the picture.
 * 2. **How far in from that rectangle's edges does the picture fade out?** The
 *    hero sits on the pack's own wallpaper, so its edges have to dissolve into
 *    whatever is behind them rather than stop.
 *
 * Answering (2) against the band instead of against (1) is the mistake this
 * module exists to prevent: it would paint a gradient across empty space where
 * there is nothing to fade, leave the picture's real edge hard, and look
 * exactly as wrong as no feather at all on any pack whose aspect ratio is not
 * the band's.
 *
 * Pure, in points, and with no opinion about Skia -- the geometry is the part
 * worth testing, and it is testable only while it is arithmetic.
 */

/**
 * How much of the picture the fade eats, per axis, as a fraction of the drawn
 * rectangle's own width and height.
 *
 * Fractions rather than a length in points, and this is the tuning knob: the
 * first attempt spent a fixed 24 pt a side, which on a 360 pt-wide hero was a
 * seventh of the width and read as a rounded rectangle with slightly blurry
 * edges rather than as a picture printed on the wallpaper. Proportions also
 * mean a short, letterboxed hero and a tall, pillarboxed one are softened by
 * the same *amount*, not by the same number of points -- which is what "scale
 * it down when the hero is short" actually wants.
 *
 * The two axes differ on purpose. The hero is a wide band between a header and
 * a list, so its top and bottom edges are the ones running alongside other
 * content and the ones that have to disappear hardest; the left and right edges
 * end at the screen's gutter, where there is less to collide with.
 *
 * At these numbers the fully opaque core is the middle 56% of the width and the
 * middle 36% of the height. Both are clamped to {@link MAX_FEATHER_FRACTION}
 * below, so no tuning pass can make the two fades on one axis meet.
 *
 * One constant, in one place, read by every caller. A theme may one day want a
 * say in it, but that would be a manifest field -- a permanent addition to a
 * published contract -- and the feedback that prompted this was about how it
 * looks, not about who decides. So the door is left open by having exactly one
 * thing to change rather than by shipping a schema change nothing asked for.
 */
export const HOME_HERO_FEATHER = {
  /** Fraction of the drawn width that fades, at the left edge and at the right. */
  horizontal: 0.22,
  /** Fraction of the drawn height that fades, at the top edge and at the bottom. */
  vertical: 0.32,
} as const;

/** Half of each axis, less a tenth kept opaque, so the two fades can never meet. */
export const MAX_FEATHER_FRACTION = 0.45;

export type FeatherSize = { width: number; height: number };
export type FeatherRect = { x: number; y: number; width: number; height: number };
export type FeatherAxes = { horizontal: number; vertical: number };

export type HeroFeather = {
  /** The `contain`-fit rectangle the drawing occupies inside the band. */
  image: FeatherRect;
  /** The solid rectangle the mask paints, already inset by half of each fade. */
  mask: FeatherRect;
  /** The mask rectangle's corner radius, so the corners give out before the sides. */
  radius: number;
  /** The Gaussian sigmas, per axis, that turn that rectangle's edges into the fades. */
  blur: { x: number; y: number };
  /** The fades themselves, in points: how wide each band is on its axis. */
  feather: { x: number; y: number };
};

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp01(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function fraction(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_FEATHER_FRACTION, Math.max(0, value));
}

/**
 * The rectangle a `contain`-fit image occupies inside a container.
 *
 * `align` is CSS `object-position` in the form the theme schema already speaks:
 * a 0..1 point on each axis, applied to the slack the fit leaves over. 0.5 on
 * both -- the default, and what a pack without a focal point gets -- is centred.
 *
 * **Without an intrinsic size the answer is the whole container.** That is the
 * documented fallback rather than an error: a picture whose decoder has not
 * reported its dimensions yet, or reports 0, still has to be drawn, and
 * feathering the container is merely the less precise answer, not a wrong one.
 * It is exactly the old framing with softened edges.
 */
export function containedImageRect(
  container: FeatherSize,
  intrinsic?: FeatherSize,
  align?: { x?: number; y?: number }
): FeatherRect {
  const width = positive(container.width);
  const height = positive(container.height);
  const whole = { x: 0, y: 0, width, height };
  const sourceWidth = positive(intrinsic?.width);
  const sourceHeight = positive(intrinsic?.height);
  if (!width || !height || !sourceWidth || !sourceHeight) return whole;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  return {
    x: (width - drawnWidth) * clamp01(align?.x),
    y: (height - drawnHeight) * clamp01(align?.y),
    width: drawnWidth,
    height: drawnHeight,
  };
}

/** The rectangle a cover-fit image occupies, preserving the theme focal point. */
export function coveredImageRect(
  container: FeatherSize,
  intrinsic?: FeatherSize,
  align?: { x?: number; y?: number }
): FeatherRect {
  const width = positive(container.width);
  const height = positive(container.height);
  const whole = { x: 0, y: 0, width, height };
  const sourceWidth = positive(intrinsic?.width);
  const sourceHeight = positive(intrinsic?.height);
  if (!width || !height || !sourceWidth || !sourceHeight) return whole;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const alignedOffset = (slack: number, focal: number | undefined) => {
    const position = clamp01(focal);
    return position === 0 ? 0 : slack * position;
  };
  return {
    x: alignedOffset(width - drawnWidth, align?.x),
    y: alignedOffset(height - drawnHeight, align?.y),
    width: drawnWidth,
    height: drawnHeight,
  };
}

/** Foreground portraits retain their top edge; only wallpaper may crop above it. */
export function editorialArtworkRect(
  container: FeatherSize,
  intrinsic: FeatherSize,
  fit: string | undefined,
  focalPoint?: { x: number; y: number }
): FeatherRect {
  if (fit === 'contain') return containedImageRect(container, intrinsic, focalPoint);
  return coveredImageRect(container, intrinsic, { x: focalPoint?.x ?? 0.5, y: 0 });
}

/**
 * The drawn rectangle, and the blurred rounded rectangle that feathers it.
 *
 * The mask is one shape rather than four edge gradients and four corner ones:
 * a solid rounded rectangle inset by half of each fade, blurred until its edges
 * *are* the fades. Three things fall out of that and are worth naming, because
 * each was asked for:
 *
 * - **The curve is an ease-in-out, not a ramp.** A hard edge convolved with a
 *   Gaussian is an error function: flat at both ends, steepest in the middle.
 *   That is the shape a gradient stop list has to be hand-tuned to imitate, and
 *   here it is simply what a blur does.
 * - **The corners give out first.** They are rounded, so the mask has already
 *   turned away from the corner before either side starts to fade, and the two
 *   fades that meet there compound. Gradients meeting at a corner do the
 *   opposite: they either double up into a dark notch or leave a square one.
 * - **The two axes are independent.** The blur is a vector, so the top and
 *   bottom can be softened harder than the left and right without distorting
 *   the picture -- see {@link HOME_HERO_FEATHER}.
 *
 * The arithmetic behind the returned numbers, since none of them is obvious:
 *
 * - A Gaussian blur of sigma `s` is visually complete at about `3s`, so an edge
 *   blurred with `s = fade / 6` spreads `fade / 2` each way: a transition
 *   exactly `fade` wide.
 * - Insetting the rectangle by `fade / 2` centres that transition on the inset
 *   edge, which puts its outer end on the picture's real edge. So alpha reaches
 *   ~0 exactly where the drawing stops -- no hard line left over -- and ~1 one
 *   full `fade` inside it.
 * - The corner radius is the larger of the two fades, which makes the corner
 *   round on the scale of the softening rather than on some unrelated one. It
 *   is capped at half the mask's shorter side, the point past which a rounded
 *   rectangle is a stadium and the radius has stopped meaning anything.
 */
export function heroFeatherGeometry({
  container,
  intrinsic,
  focalPoint,
  feather = HOME_HERO_FEATHER,
}: {
  container: FeatherSize;
  intrinsic?: FeatherSize;
  focalPoint?: { x: number; y: number };
  feather?: FeatherAxes;
}): HeroFeather {
  const image = containedImageRect(container, intrinsic, focalPoint);
  const fadeX = image.width * fraction(feather.horizontal);
  const fadeY = image.height * fraction(feather.vertical);
  const mask = {
    x: image.x + fadeX / 2,
    y: image.y + fadeY / 2,
    width: Math.max(0, image.width - fadeX),
    height: Math.max(0, image.height - fadeY),
  };
  return {
    image,
    mask,
    radius: Math.min(Math.max(fadeX, fadeY), Math.min(mask.width, mask.height) / 2),
    blur: { x: fadeX / 6, y: fadeY / 6 },
    feather: { x: fadeX, y: fadeY },
  };
}

/** Ignore nearly transparent export residue when locating the foreground's top.
 * This is an alignment guide only: no source pixels are cropped away.
 */
export function artworkVisibleTop(alpha: ArrayLike<number>, width: number, height: number): number {
  if (width <= 0 || height <= 0 || alpha.length < width * height) return 0;
  const minimumPixels = Math.max(1, Math.ceil(width * 0.002));
  for (let y = 0; y < height; y++) {
    let visible = 0;
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] >= 32 && ++visible >= minimumPixels) return y;
    }
  }
  return 0;
}
