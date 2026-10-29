import { Fill, ImageShader, Shader, Skia, type SkImage } from 'react-native-skia';
import { useEffect, useRef, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { snapCellSize, SNAP_DUST_SKSL } from '@/lib/snap-dissolve';

/**
 * The dust shader, compiled once at module load. Null when this device's Skia
 * cannot compile it; callers must use their non-shader fallback.
 */
function compileDust() {
  try {
    return Skia.RuntimeEffect.Make(SNAP_DUST_SKSL);
  } catch {
    return null;
  }
}
export const PARTICLE_EFFECT = compileDust();

/**
 * Particle drawing primitive for an existing Skia Canvas. Zero progress shows
 * the source image intact; one dissolves it completely. Reverse progress for
 * reassembly. The owner controls timing and retains the image until unmount.
 * Use ParticleTransition for a standalone surface with GPU readiness and
 * reduced-motion fallback. No navigation or theme state is owned here.
 */
export function ParticleField({
  image,
  width,
  height,
  progress,
  tint,
  onReady,
}: {
  /** Source image, retained by the caller for the lifetime of this field. */
  image: SkImage;
  /** The canvas's width in points; the snapshot is at device resolution. */
  width: number;
  /** Optional viewport height for a cover-fitted full-surface transition. */
  height?: number;
  progress: SharedValue<number>;
  /** Optional theme accent for image reassembly; launch keeps its existing ash. */
  tint?: string;
  /** Called once the dust is in the canvas: the moment to start `progress`. */
  onReady: () => void;
}) {
  // Snapshot pixels map to logical viewport points.
  const field = useMemo(() => {
    const ratio = width > 0 ? image.width() / width : 1;
    const frameHeight = height ?? image.height() / ratio;
    return { width, height: frameHeight, cell: snapCellSize(width, frameHeight, ratio) };
  }, [image, width, height]);
  const dustTint = Array.from(Skia.Color(tint ?? 'transparent'));
  const tintStrength = tint ? 1 : 0;
  const uniforms = useDerivedValue(() => ({
    size: [field.width, field.height],
    cell: field.cell,
    progress: progress.get(),
    dustTint,
    tintStrength,
  }));

  // Committed into the canvas: the snap can start from its first grain. Once,
  // whatever identity the callback has by the next render.
  const ready = useRef(false);
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    onReady();
  }, [onReady]);

  if (!PARTICLE_EFFECT) return null;
  return (
    <Fill>
      <Shader source={PARTICLE_EFFECT} uniforms={uniforms}>
        <ImageShader
          fit={height === undefined ? 'fill' : 'cover'}
          height={field.height}
          image={image}
          tx="decal"
          ty="decal"
          width={field.width}
          x={0}
          y={0}
        />
      </Shader>
    </Fill>
  );
}
