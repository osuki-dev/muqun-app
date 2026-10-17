import { ImageShader, Rect, Shader, Skia, type SkImage } from 'react-native-skia';
import { useMemo } from 'react';
import { PixelRatio } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { HERO_GATHER_MARGIN, HERO_GATHER_SKSL } from '@/lib/hero-gather';
import { snapCellSize } from '@/lib/snap-dissolve';

/**
 * The gather shader, compiled once at module load. Null when this device's
 * Skia cannot compile it, in which case the scene draws the picture plain and
 * the opening is what it was before this beat existed.
 */
function compileGather() {
  try {
    return Skia.RuntimeEffect.Make(HERO_GATHER_SKSL);
  } catch {
    return null;
  }
}
export const HERO_GATHER_EFFECT = compileGather();

/**
 * The launch picture, drawn through the gather (`hero-gather.ts`): whole at
 * `progress` 0, loosened into drifting grains as it rises, whole again as it
 * falls. Drawn where the plain picture would be, inside the same group, so
 * the picture's flight into Home's band carries the grains with it.
 *
 * The rectangle is the picture's plus a margin on every side for the grains
 * to fly into; the sampler is decal, so outside the picture there is nothing
 * to sample and nothing is drawn.
 */
export function HeroGather({
  frame,
  image,
  progress,
}: {
  frame: { left: number; top: number; width: number; height: number };
  image: SkImage;
  progress: SharedValue<number>;
}) {
  const cell = useMemo(
    () => snapCellSize(frame.width, frame.height, PixelRatio.get()),
    [frame.width, frame.height]
  );
  const uniforms = useDerivedValue(() => ({
    origin: [frame.left, frame.top],
    size: [frame.width, frame.height],
    cell,
    progress: progress.get(),
  }));
  if (!HERO_GATHER_EFFECT) return null;
  return (
    <Rect
      height={frame.height + HERO_GATHER_MARGIN * 2}
      width={frame.width + HERO_GATHER_MARGIN * 2}
      x={frame.left - HERO_GATHER_MARGIN}
      y={frame.top - HERO_GATHER_MARGIN}>
      <Shader source={HERO_GATHER_EFFECT} uniforms={uniforms}>
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
