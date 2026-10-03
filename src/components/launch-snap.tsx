import { Atlas, Canvas, Skia, type SkColor, type SkImage, type SkRSXform } from 'react-native-skia';
import { useEffect, useEffectEvent, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useAnimatedReaction,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  snapGrid,
  snapTile,
  snapTileSize,
  snapTileTransform,
  type SnapTile,
  type SnapTransform,
} from '@/lib/snap-dissolve';

/**
 * How long the snap canvas is on screen, drawing the untouched snapshot over
 * the live scene, before anything moves.
 *
 * A Skia canvas mounted this frame has not necessarily presented this frame.
 * Until the first tile moves, the snapshot and the live scene are the same
 * picture, so the live scene stays up underneath and nothing can be seen to
 * swap; the live scene is hidden on the frame progress leaves 0. Three frames
 * at 60 Hz is the margin for the canvas to have drawn by then.
 */
export const SNAP_MOUNT_MS = 48;

/**
 * The opening's exit: a snapshot of the finished sheet, cut into tiles that
 * drift off up and to the right and fade, with Home beneath. One `Atlas`, so
 * one draw call however many tiles there are; every tile's `RSXform` and
 * alpha is written on the UI thread from `progress` into arrays allocated
 * once, so a frame of the snap allocates two scratch objects, not thousands.
 *
 * `progress` belongs to the scene, which hides its live sheet the moment it
 * leaves 0. This component runs it from 0 to 1 over `durationMs` and calls
 * `onFinish` at 1.
 */
export function LaunchSnap({
  image,
  width,
  height,
  progress,
  durationMs,
  onFinish,
}: {
  image: SkImage;
  width: number;
  height: number;
  progress: SharedValue<number>;
  durationMs: number;
  onFinish: () => void;
}) {
  // Latched at mount, like the snapshot it cuts up: sprites, transforms and
  // colours must stay the same length for the life of the draw.
  const [atlas] = useState(() => {
    const grid = snapGrid(width, height, snapTileSize(width, height));
    // The snapshot is taken at device resolution; measured rather than assumed.
    const ratio = width > 0 ? image.width() / width : 1;
    const scratch: SnapTile = { x: 0, y: 0, w: 0, h: 0, hash: 0, sweep: 0 };
    const sprites = Array.from({ length: grid.count }, (_, index) => {
      const tile = snapTile(grid, index, scratch);
      return Skia.XYWHRect(tile.x * ratio, tile.y * ratio, tile.w * ratio, tile.h * ratio);
    });
    const xforms = Array.from({ length: grid.count }, () => Skia.RSXform(1, 0, 0, 0));
    // White at the tile's alpha, multiplied into the sprite (`modulate`).
    // White, so that once Skia premultiplies it the product is the sprite
    // scaled by alpha rather than darkened by it.
    const tints = Array.from({ length: grid.count }, () => Skia.Color('white'));
    return { grid, ratio, sprites, xforms, tints };
  });
  const { grid, ratio } = atlas;
  const transforms = useSharedValue<SkRSXform[]>(atlas.xforms);
  const colors = useSharedValue<SkColor[]>(atlas.tints);

  useAnimatedReaction(
    () => progress.get(),
    (p) => {
      const tile: SnapTile = { x: 0, y: 0, w: 0, h: 0, hash: 0, sweep: 0 };
      const out: SnapTransform = { scos: 0, ssin: 0, tx: 0, ty: 0, alpha: 0 };
      const xforms = transforms.get();
      const tints = colors.get();
      const count = Math.min(grid.count, xforms.length, tints.length);
      for (let index = 0; index < count; index++) {
        snapTileTransform(snapTile(grid, index, tile), p, ratio, out);
        xforms[index]!.set(out.scos, out.ssin, out.tx, out.ty);
        tints[index]![3] = out.alpha;
      }
      // Same arrays, new contents: force the listeners so the canvas redraws.
      transforms.modify(undefined, true);
      colors.modify(undefined, true);
    }
  );

  // The snap is one event, started on mount; what it reads is not a reason to restart it.
  const start = useEffectEvent(() => {
    progress.set(
      withDelay(
        SNAP_MOUNT_MS,
        withTiming(
          1,
          {
            duration: Math.max(0, durationMs - SNAP_MOUNT_MS),
            // Linear on purpose: every tile eases its own departure, and an
            // eased clock on top would bunch the sweep at one end.
            easing: Easing.linear,
            reduceMotion: ReduceMotion.Never,
          },
          (finished) => {
            if (finished) scheduleOnRN(onFinish);
          }
        )
      )
    );
  });
  useEffect(() => {
    start();
  }, []);

  // The snapshot is this component's to release.
  useEffect(() => () => image.dispose(), [image]);

  return (
    <Canvas androidWarmup pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Atlas
        colorBlendMode="modulate"
        colors={colors}
        image={image}
        sprites={atlas.sprites}
        transforms={transforms}
      />
    </Canvas>
  );
}
