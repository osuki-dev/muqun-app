import { ImageShader, Rect, Shader, Skia, type SkImage } from 'react-native-skia';
import { useMemo } from 'react';
import { PixelRatio } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import {
  HERO_TRAIL_CELL_SCALE,
  HERO_TRAIL_DENSITY,
  HERO_TRAIL_MARGIN,
  HERO_TRAIL_SKSL,
} from '@/lib/hero-dust-trail';
import { snapCellSize } from '@/lib/snap-dissolve';

/**
 * The trail shader, compiled once at module load. Null when this device's
 * Skia cannot compile it, in which case the scene draws the picture plain and
 * the opening is what it was before this beat existed.
 */
function compileTrail() {
  try {
    return Skia.RuntimeEffect.Make(HERO_TRAIL_SKSL);
  } catch {
    return null;
  }
}
export const HERO_TRAIL_EFFECT = compileTrail();

/**
 * The launch picture with ash lifting off its outline (`hero-dust-trail.ts`).
 * Drawn where the plain picture would be, inside the same group, so the
 * picture's flight into Home's band carries the grains with it. `time` is
 * the grain clock in seconds and `fade` the drift's overall strength; with
 * `fade` at 0 this is the plain picture.
 *
 * The rectangle is the picture's plus a margin on every side for the grains
 * to drift into; the sampler is decal, so outside the picture there is
 * nothing to sample and nothing is drawn.
 */
export function HeroDustTrail({
  frame,
  image,
  time,
  fade,
}: {
  frame: { left: number; top: number; width: number; height: number };
  image: SkImage;
  time: SharedValue<number>;
  fade: SharedValue<number>;
}) {
  const cell = useMemo(
    () => snapCellSize(frame.width, frame.height, PixelRatio.get()) * HERO_TRAIL_CELL_SCALE,
    [frame.width, frame.height]
  );
  const uniforms = useDerivedValue(() => ({
    cell,
    time: time.get(),
    fade: fade.get(),
    density: HERO_TRAIL_DENSITY,
  }));
  if (!HERO_TRAIL_EFFECT) return null;
  return (
    <Rect
      height={frame.height + HERO_TRAIL_MARGIN * 2}
      width={frame.width + HERO_TRAIL_MARGIN * 2}
      x={frame.left - HERO_TRAIL_MARGIN}
      y={frame.top - HERO_TRAIL_MARGIN}>
      <Shader source={HERO_TRAIL_EFFECT} uniforms={uniforms}>
        <ImageShader
          fit="contain"
          height={frame.height}
          image={image}
          tx="decal"
          ty="decal"
          width={frame.width}
          x={frame.left}
          y={frame.top}
        />
      </Shader>
    </Rect>
  );
}
