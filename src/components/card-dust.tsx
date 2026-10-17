import { Canvas, Fill, Group, ImageShader, Shader, Skia, type SkImage } from 'react-native-skia';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { CARD_DUST_SKSL } from '@/lib/card-dust';
import { snapCellSize } from '@/lib/snap-dissolve';

/**
 * The card dust shader, compiled once at module load. Null when this device's
 * Skia cannot compile it; the deck then cross-fades instead.
 */
function compileCardDust() {
  try {
    return Skia.RuntimeEffect.Make(CARD_DUST_SKSL);
  } catch {
    return null;
  }
}
export const CARD_DUST_EFFECT = compileCardDust();

/** A photograph of a card and the size it was laid out at, in points. */
export type CardShot = { image: SkImage; width: number; height: number };

/**
 * Two cards through the dust (`card-dust.ts`), in one canvas over the deck's
 * front slot: the incoming one underneath, reforming, and the outgoing one
 * over it, eroding. Per frame the CPU writes two uniform blocks; every grain
 * is computed on the GPU. The canvas is larger than the cards by the room the
 * ash blows into (`offsetX` either side, `offsetY` above), and draws nothing
 * where neither is.
 */
export function CardDust({
  outgoing,
  incoming,
  width,
  height,
  direction,
  outProgress,
  inProgress,
  offsetX,
  offsetY,
  token,
  onDrawn,
}: {
  outgoing: CardShot | null;
  incoming: CardShot | null;
  width: number;
  height: number;
  /** -1: the erosion starts at the left edge and the ash blows left. */
  direction: number;
  outProgress: SharedValue<number>;
  inProgress: SharedValue<number>;
  /** Where the cards' top-left corner is in the canvas. */
  offsetX: number;
  offsetY: number;
  /** The move this canvas draws, handed back to `onDrawn`. */
  token: number;
  /** The canvas has had time to present its first frame. */
  onDrawn: (token: number) => void;
}) {
  // Two frames: one for the canvas to commit, one for it to have drawn.
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onDrawn(token));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [onDrawn, token]);
  const ratio = outgoing ? outgoing.image.width() / Math.max(1, outgoing.width) : 1;
  const outCell = outgoing ? snapCellSize(outgoing.width, outgoing.height, ratio) : 1;
  const inCell = incoming ? snapCellSize(incoming.width, incoming.height, ratio) : 1;
  const outWidth = outgoing?.width ?? 0;
  const outHeight = outgoing?.height ?? 0;
  const inWidth = incoming?.width ?? 0;
  const inHeight = incoming?.height ?? 0;
  const outUniforms = useDerivedValue(() => ({
    size: [outWidth, outHeight],
    cell: outCell,
    progress: outProgress.get(),
    direction,
  }));
  // Reformed against the other way, so it comes back from the leading edge
  // first and its ash, run backwards, still blows the way the pull went.
  const inUniforms = useDerivedValue(() => ({
    size: [inWidth, inHeight],
    cell: inCell,
    progress: inProgress.get(),
    direction: -direction,
  }));
  if (!CARD_DUST_EFFECT) return null;
  return (
    <Canvas pointerEvents="none" style={[styles.canvas, { width, height }]}>
      <Group transform={[{ translateX: offsetX }, { translateY: offsetY }]}>
        {incoming ? (
          <Fill>
            <Shader source={CARD_DUST_EFFECT} uniforms={inUniforms}>
              <ImageShader
                fit="fill"
                height={incoming.height}
                image={incoming.image}
                tx="decal"
                ty="decal"
                width={incoming.width}
                x={0}
                y={0}
              />
            </Shader>
          </Fill>
        ) : null}
        {outgoing ? (
          <Fill>
            <Shader source={CARD_DUST_EFFECT} uniforms={outUniforms}>
              <ImageShader
                fit="fill"
                height={outgoing.height}
                image={outgoing.image}
                tx="decal"
                ty="decal"
                width={outgoing.width}
                x={0}
                y={0}
              />
            </Shader>
          </Fill>
        ) : null}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
