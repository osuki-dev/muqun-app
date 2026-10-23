import { Canvas, Fill, Group, ImageShader, Shader, Skia, type SkImage } from 'react-native-skia';
import { useEffect } from 'react';
import { useThemeTokens } from '@osuki-dev/ui';
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
  const theme = useThemeTokens();
  const tint = Array.from(Skia.Color(theme.colors.primary));
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
    tint,
    progress: outProgress.get(),
    direction,
    axis: 0,
    spread: 1,
    gather: 0,
    glow: 0,
  }));
  // Reformed against the other way, so it comes back from the leading edge
  // first and its ash, run backwards, still blows the way the pull went.
  const inUniforms = useDerivedValue(() => ({
    size: [inWidth, inHeight],
    cell: inCell,
    tint,
    progress: inProgress.get(),
    direction: -direction,
    axis: 0,
    spread: 1,
    gather: 0,
    glow: 0,
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

/**
 * One sheet through the dust, standing: the front starts at its bottom edge
 * and the ash falls, spreading outwards. With `progress` rising from 0 the
 * sheet erodes into the dock under it; falling from 1, the ash rises out of
 * the dock and settles into the sheet from the top down, and at 0 the canvas
 * shows the photograph whole, so the live sheet can take over unseen.
 *
 * The front's reach is `extent`: the sheet's height above the dock's field,
 * so a sheet let go partway down erodes from where it stands, not from a
 * bottom edge hidden under the dock. The canvas is the size of the photograph.
 */
export function SheetDust({
  shot,
  extent,
  progress,
  token,
  onDrawn,
}: {
  shot: CardShot;
  /** How far down from the photograph's top edge the front may reach, in points. */
  extent: number;
  progress: SharedValue<number>;
  /** The transition this canvas draws, handed back to `onDrawn`. */
  token: number;
  /** The canvas has had time to present its first frame. */
  onDrawn: (token: number) => void;
}) {
  const theme = useThemeTokens();
  const tint = Array.from(Skia.Color(theme.colors.primary));
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
  const ratio = shot.image.width() / Math.max(1, shot.width);
  // Coarser grains than a card's, still on device pixels: on a surface this
  // large the card's grain is a fine noise, and grains have to be seen to gather.
  const cell =
    Math.max(1, Math.round(snapCellSize(shot.width, shot.height, ratio) * SHEET_GRAIN * ratio)) /
    ratio;
  const shotWidth = shot.width;
  const reach = Math.max(1, Math.min(shot.height, extent));
  const spread = sheetSpread(reach);
  const uniforms = useDerivedValue(() => ({
    size: [shotWidth, reach],
    cell,
    tint,
    progress: progress.get(),
    direction: 1,
    axis: 1,
    spread,
    gather: SHEET_GATHER,
    glow: SHEET_GLOW,
  }));
  if (!CARD_DUST_EFFECT) return null;
  return (
    <Canvas
      pointerEvents="none"
      style={[styles.canvas, { width: shot.width, height: shot.height }]}>
      <Fill>
        <Shader source={CARD_DUST_EFFECT} uniforms={uniforms}>
          <ImageShader
            fit="fill"
            height={shot.height}
            image={shot.image}
            tx="decal"
            ty="decal"
            width={shot.width}
            x={0}
            y={0}
          />
        </Shader>
      </Fill>
    </Canvas>
  );
}

/** A sheet's grain, as a multiple of a card's. */
const SHEET_GRAIN = 1.6;
/** A sheet's grains land before its picture forms (`gather`), and glow (`glow`). */
const SHEET_GATHER = 0.25;
const SHEET_GLOW = 0.8;
/** The height of a deck card, which the dust's travel was drawn for. */
const CARD_REACH = 150;
/** How far a sheet's ash travels, as a multiple of a card's: with its height, up to three times. */
export function sheetSpread(reach: number): number {
  return Math.min(3, Math.max(1.4, reach / CARD_REACH));
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
