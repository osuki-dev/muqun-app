import { Fill, ImageShader, Shader, Skia, type SkImage } from 'react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { snapCellSize, SNAP_DUST_SKSL } from '@/lib/snap-dissolve';

/**
 * The dust shader, compiled once at module load. Null when this device's Skia
 * cannot compile it, in which case the scene never plans the snap and the
 * launch ends on the cross-fade.
 */
export const SNAP_DUST_EFFECT = Skia.RuntimeEffect.Make(SNAP_DUST_SKSL);

/**
 * The opening's exit, drawn inside the opening's own canvas: the frame that
 * canvas was showing, turned to dust that blows off up and to the right, with
 * Home beneath (the arithmetic and why it is a fragment shader are in
 * `snap-dissolve.ts`).
 *
 * It replaces the scene's children in the same `<Canvas>`, so there is no
 * second surface to come up and no frame in which neither is on screen: at
 * `progress = 0` every grain is where it was cut from and the frame is the
 * one the canvas was already presenting. Per frame the CPU writes one
 * uniform block; every grain is computed on the GPU.
 *
 * A child of Skia's reconciler, so it uses only state, a ref, an effect and a
 * derived value -- `useEffectEvent` threw in that renderer. The clock and the
 * snapshot's disposal belong to the scene, in React Native's renderer; this
 * only says when it is ready for the clock.
 */
export function SnapDust({
  image,
  width,
  progress,
  onReady,
}: {
  /** `makeImageSnapshot()` of the canvas this is drawn into. */
  image: SkImage;
  /** The canvas's width in points; the snapshot is at device resolution. */
  width: number;
  progress: SharedValue<number>;
  /** Called once the dust is in the canvas: the moment to start `progress`. */
  onReady: () => void;
}) {
  // Latched at mount, like the snapshot it is drawn from.
  const [field] = useState(() => {
    const ratio = width > 0 ? image.width() / width : 1;
    const height = image.height() / ratio;
    return { width, height, cell: snapCellSize(width, height, ratio) };
  });
  const uniforms = useDerivedValue(() => ({
    size: [field.width, field.height],
    cell: field.cell,
    progress: progress.get(),
  }));

  // Committed into the canvas: the snap can start from its first grain. Once,
  // whatever identity the callback has by the next render.
  const ready = useRef(false);
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    onReady();
  }, [onReady]);

  if (!SNAP_DUST_EFFECT) return null;
  return (
    <Fill>
      <Shader source={SNAP_DUST_EFFECT} uniforms={uniforms}>
        <ImageShader
          fit="fill"
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
