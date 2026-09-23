/**
 * The hero's fade is geometry before it is a picture.
 *
 * What these hold is the one thing a screenshot cannot: that the softened edge
 * follows the *drawing*, not the band it sits in. Every pack has a different
 * aspect ratio, and the band is a ceiling rather than a size, so almost every
 * hero is letterboxed or pillarboxed by some amount -- feathering the container
 * would put the gradient in the empty space beside the picture on all of them.
 */
import { describe, expect, test } from 'bun:test';

import {
  containedImageRect,
  coveredImageRect,
  editorialArtworkRect,
  heroFeatherGeometry,
  HOME_HERO_FEATHER,
  MAX_FEATHER_FRACTION,
} from '@/lib/hero-feather';

/** The compact band: full phone width, `HOME_HERO_MAX_HEIGHT.compact` tall. */
const BAND = { width: 360, height: 180 };

describe('Editorial foreground framing', () => {
  test.each([360, 600, 900])(
    'keeps the portrait head at width %i without shrinking it',
    (width) => {
      const box = { width, height: Math.min(640, width * 0.9) };
      const source = { width: 1024, height: 1536 };
      const focalPoint = { x: 0.58, y: 0.35 };
      const previous = coveredImageRect(box, source, focalPoint);
      const next = editorialArtworkRect(box, source, 'cover', focalPoint);
      expect(previous.y).toBeLessThan(0);
      expect(next.y).toBe(0);
      expect(next.width).toBe(previous.width);
      expect(next.height).toBe(previous.height);
    }
  );

  test('retains horizontal framing for wide foregrounds', () => {
    const source = { width: 2400, height: 800 };
    const focalPoint = { x: 0.8, y: 0.35 };
    expect(editorialArtworkRect(BAND, source, 'cover', focalPoint)).toEqual(
      coveredImageRect(BAND, source, focalPoint)
    );
  });

  test('contain artwork retains its authored positioning', () => {
    const source = { width: 1024, height: 1536 };
    const focalPoint = { x: 0.8, y: 0.35 };
    expect(editorialArtworkRect(BAND, source, 'contain', focalPoint)).toEqual(
      containedImageRect(BAND, source, focalPoint)
    );
  });
});

describe('the drawn rectangle', () => {
  test('a wide drawing is letterboxed and the empty rows are not part of it', () => {
    // 3:1 into a 2:1 band: width binds, so the picture is 120 tall and centred.
    const rect = containedImageRect(BAND, { width: 1200, height: 400 });
    expect(rect).toEqual({ x: 0, y: 30, width: 360, height: 120 });
  });

  test('a tall drawing is pillarboxed', () => {
    // 1:2 into a 2:1 band: height binds.
    const rect = containedImageRect(BAND, { width: 400, height: 800 });
    expect(rect).toEqual({ x: 135, y: 0, width: 90, height: 180 });
  });

  test('a drawing with the same ratio as the band fills it exactly', () => {
    expect(containedImageRect(BAND, { width: 720, height: 360 })).toEqual({
      x: 0,
      y: 0,
      width: 360,
      height: 180,
    });
  });

  test('the focal point spends the slack, and only the slack', () => {
    const top = containedImageRect(BAND, { width: 1200, height: 400 }, { x: 0.5, y: 0 });
    const bottom = containedImageRect(BAND, { width: 1200, height: 400 }, { x: 0.5, y: 1 });
    expect(top.y).toBe(0);
    expect(bottom.y).toBe(60);
    // The axis that binds has no slack to spend, whatever the focal point says.
    expect(top.x).toBe(0);
    expect(bottom.x).toBe(0);
    expect(top.width).toBe(360);
  });

  test('a focal point outside 0..1, or not a number, is clamped to something sane', () => {
    const drawing = { width: 400, height: 800 };
    expect(containedImageRect(BAND, drawing, { x: 4, y: 0.5 }).x).toBe(270);
    expect(containedImageRect(BAND, drawing, { x: -4, y: 0.5 }).x).toBe(0);
    expect(containedImageRect(BAND, drawing, { x: Number.NaN, y: 0.5 }).x).toBe(135);
  });

  test('no intrinsic size falls back to the whole container', () => {
    // The documented fallback: a decoder that has not answered yet still has to
    // draw something, and the container is the less precise answer, not a wrong
    // one. A reported 0 is the same case.
    expect(containedImageRect(BAND)).toEqual({ x: 0, y: 0, width: 360, height: 180 });
    expect(containedImageRect(BAND, { width: 0, height: 400 })).toEqual({
      x: 0,
      y: 0,
      width: 360,
      height: 180,
    });
    expect(containedImageRect(BAND, { width: Number.NaN, height: 400 }).width).toBe(360);
  });

  test('a container with no size yet is not a division by zero', () => {
    const rect = containedImageRect({ width: 0, height: 0 }, { width: 1200, height: 400 });
    expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('the Editorial cover rectangle', () => {
  test('fills the full-width band and crops the overflow', () => {
    expect(coveredImageRect(BAND, { width: 400, height: 800 })).toEqual({
      x: 0,
      y: -270,
      width: 360,
      height: 720,
    });
  });

  test('the focal point chooses which part of the crop survives', () => {
    const drawing = { width: 400, height: 800 };
    expect(coveredImageRect(BAND, drawing, { x: 0.5, y: 0 }).y).toBe(0);
    expect(coveredImageRect(BAND, drawing, { x: 0.5, y: 1 }).y).toBe(-540);
  });

  test('invalid dimensions safely fill the container', () => {
    expect(coveredImageRect(BAND)).toEqual({ x: 0, y: 0, width: 360, height: 180 });
  });
});

describe('the feather', () => {
  test('it surrounds the drawing rather than the band', () => {
    const { image, mask, feather } = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 1200, height: 400 },
    });
    expect(image).toEqual({ x: 0, y: 30, width: 360, height: 120 });
    // 22% of 360 and 32% of 120, off the picture's own size.
    expect(feather.x).toBeCloseTo(79.2, 10);
    expect(feather.y).toBeCloseTo(38.4, 10);
    // Inset by half of each, starting from the picture's own top edge at y=30 --
    // not from the band's at y=0.
    expect(mask.x).toBeCloseTo(39.6, 10);
    expect(mask.y).toBeCloseTo(49.2, 10);
    expect(mask.width).toBeCloseTo(280.8, 10);
    expect(mask.height).toBeCloseTo(81.6, 10);
  });

  test('each fade covers the fraction of the picture the constant asks for', () => {
    // The maintainer's numbers, stated as the thing they actually constrain: how
    // much of the drawing is spent on each edge, and how much is left over fully
    // opaque in the middle.
    const { image, feather } = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
    });
    expect(feather.x / image.width).toBeCloseTo(HOME_HERO_FEATHER.horizontal, 10);
    expect(feather.y / image.height).toBeCloseTo(HOME_HERO_FEATHER.vertical, 10);
    expect(feather.x / image.width).toBeGreaterThanOrEqual(0.2);
    expect(feather.x / image.width).toBeLessThanOrEqual(0.25);
    expect(feather.y / image.height).toBeGreaterThanOrEqual(0.3);
    expect(feather.y / image.height).toBeLessThanOrEqual(0.35);
    // The opaque core: the middle 56% across, the middle 36% down.
    expect(1 - (2 * feather.x) / image.width).toBeCloseTo(0.56, 10);
    expect(1 - (2 * feather.y) / image.height).toBeCloseTo(0.36, 10);
  });

  test('each fade lands exactly on its edge of the picture, and is one fade wide', () => {
    // The numbers the renderer is given have to agree with the sentence in the
    // doc comment: blurring the mask edge by 3 sigma either way spreads it half a
    // fade, and the mask edge sits half a fade in. So the outer end of each
    // transition is the picture's edge and the inner end is one fade inside it.
    const { image, mask, blur, feather } = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
    });
    expect(blur.x * 3).toBeCloseTo(feather.x / 2, 10);
    expect(blur.y * 3).toBeCloseTo(feather.y / 2, 10);
    expect(mask.x - blur.x * 3).toBeCloseTo(image.x, 10);
    expect(mask.x + mask.width + blur.x * 3).toBeCloseTo(image.x + image.width, 10);
    expect(mask.y - blur.y * 3).toBeCloseTo(image.y, 10);
    expect(mask.y + mask.height + blur.y * 3).toBeCloseTo(image.y + image.height, 10);
  });

  test('the two axes are softened independently', () => {
    // The whole reason the mask's blur is a vector: a wide hero's top and bottom
    // give out harder than its sides, in points as well as in proportion.
    const { blur, feather } = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
    });
    expect(feather.y / feather.x).toBeCloseTo(
      (HOME_HERO_FEATHER.vertical * 180) / (HOME_HERO_FEATHER.horizontal * 360),
      10
    );
    expect(Math.abs(blur.x - blur.y)).toBeGreaterThan(1);
  });

  test('the corners round on the scale of the fade, and never past a stadium', () => {
    const wide = heroFeatherGeometry({ container: BAND, intrinsic: { width: 1200, height: 400 } });
    // Capped at half the mask's shorter side; past that a rounded rect is a
    // stadium and the radius has stopped meaning anything.
    expect(wide.radius).toBeCloseTo(Math.min(wide.mask.width, wide.mask.height) / 2, 10);
    // A squarer picture has room for the larger of the two fades instead.
    const square = heroFeatherGeometry({ container: BAND, intrinsic: { width: 400, height: 400 } });
    expect(square.radius).toBeCloseTo(Math.max(square.feather.x, square.feather.y), 10);
    expect(square.radius).toBeLessThan(Math.min(square.mask.width, square.mask.height) / 2);
  });

  test('the fade is proportional, so a short hero is softened by the same amount', () => {
    // A panorama 40 points tall in the compact band. There is no fixed number of
    // points to scale down: 32% of 40 is 12.8, and the middle 36% is still there.
    const short = heroFeatherGeometry({ container: BAND, intrinsic: { width: 1800, height: 200 } });
    expect(short.image.height).toBe(40);
    expect(short.feather.y).toBeCloseTo(12.8, 10);
    expect(short.feather.y / short.image.height).toBeCloseTo(HOME_HERO_FEATHER.vertical, 10);
  });

  test('the middle of the picture is always opaque, on every ratio a pack could ship', () => {
    for (const [width, height] of [
      [4000, 100],
      [100, 4000],
      [1200, 400],
      [720, 360],
      [1, 1],
      [640, 641],
    ]) {
      const { image, feather } = heroFeatherGeometry({
        container: BAND,
        intrinsic: { width, height },
      });
      expect(feather.x * 2).toBeLessThan(image.width);
      expect(feather.y * 2).toBeLessThan(image.height);
    }
  });

  test('the mask never inverts, however little there is to feather', () => {
    for (const container of [
      { width: 0, height: 0 },
      { width: 360, height: 0 },
      { width: 2, height: 1 },
    ]) {
      const { mask, feather, blur, radius } = heroFeatherGeometry({ container });
      expect(mask.width).toBeGreaterThanOrEqual(0);
      expect(mask.height).toBeGreaterThanOrEqual(0);
      expect(feather.x).toBeGreaterThanOrEqual(0);
      expect(feather.y).toBeGreaterThanOrEqual(0);
      expect(blur.x).toBeGreaterThanOrEqual(0);
      expect(radius).toBeGreaterThanOrEqual(0);
    }
  });

  test('the strength is read from one place, and a caller may still override it', () => {
    // No manifest field and no second constant: the component passes nothing, and
    // the only way to a different feather is this argument.
    const standard = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
    });
    expect(standard.feather.x / standard.image.width).toBeCloseTo(HOME_HERO_FEATHER.horizontal, 10);
    const softer = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
      feather: { horizontal: 0.1, vertical: 0.1 },
    });
    expect(softer.feather.x).toBeCloseTo(36, 10);
    expect(softer.mask.x).toBeCloseTo(18, 10);
  });

  test('a tuning pass cannot make the two fades on one axis meet', () => {
    // The clamp is the promise, and it holds against nonsense as well as against
    // an over-enthusiastic edit.
    const greedy = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
      feather: { horizontal: 4, vertical: 0.9 },
    });
    expect(greedy.feather.x).toBeCloseTo(360 * MAX_FEATHER_FRACTION, 10);
    expect(greedy.feather.y).toBeCloseTo(180 * MAX_FEATHER_FRACTION, 10);
    expect(greedy.mask.width).toBeGreaterThan(0);
    expect(greedy.mask.height).toBeGreaterThan(0);
    const nonsense = heroFeatherGeometry({
      container: BAND,
      intrinsic: { width: 720, height: 360 },
      feather: { horizontal: -1, vertical: Number.NaN },
    });
    expect(nonsense.feather).toEqual({ x: 0, y: 0 });
    expect(nonsense.mask).toEqual(nonsense.image);
  });
});
