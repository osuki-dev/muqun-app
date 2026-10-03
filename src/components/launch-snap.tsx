import {
  AlphaType,
  Atlas,
  Canvas,
  ColorType,
  Skia,
  type SkColor,
  type SkImage,
  type SkRSXform,
} from 'react-native-skia';
import { useEffect, useEffectEvent, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
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
 * drift off up and to the right and fade, with Home beneath.
 *
 * The canvas goes up before there is anything to draw on it -- the scene
 * mounts this while the opening is still playing -- holding one invisible
 * sprite. A Graphite canvas's first frame is a new surface and a set of
 * pipelines to compile, and on the emulators that first frame landed about a
 * second after mounting: longer than the whole snap, so a canvas mounted at
 * the exit cut straight to Home. Warmed up, the exit only swaps what an
 * already-presenting canvas draws.
 *
 * `progress` belongs to the scene, which hides its live sheet the moment it
 * leaves 0. Once `image` arrives this runs it from 0 to 1 over `durationMs`
 * and calls `onFinish` at 1.
 */
export function LaunchSnap({
  image,
  width,
  frame,
  progress,
  durationMs,
  onFinish,
}: {
  image: SkImage | null;
  /** The window's width in points, which the snapshot spans. */
  width: number;
  /** Where the captured view sat, which is where its tiles start. */
  frame: StyleProp<ViewStyle>;
  progress: SharedValue<number>;
  durationMs: number;
  onFinish: () => void;
}) {
  // The clock and the snapshot's lifetime live out here, in React Native's
  // renderer, rather than in the atlas under the canvas: Skia's reconciler
  // does not implement `useEffectEvent`. The snap is one event per picture;
  // what starting it reads is not a reason to restart it.
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
    if (!image) return;
    start();
    // The snapshot is this component's to release.
    return () => image.dispose();
  }, [image]);

  return (
    <Canvas pointerEvents="none" style={frame}>
      {image ? <SnapAtlas image={image} progress={progress} width={width} /> : <WarmAtlas />}
    </Canvas>
  );
}

/**
 * One fully transparent sprite through the same Atlas, blend and sampling the
 * snap uses, so the canvas is presenting and its pipeline is built before the
 * snap needs either.
 */
function WarmAtlas() {
  const [warm] = useState(() => {
    const pixel = Skia.Image.MakeImage(
      { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Premul },
      Skia.Data.fromBytes(new Uint8Array([255, 255, 255, 255])),
      4
    );
    return {
      image: pixel,
      sprites: [Skia.XYWHRect(0, 0, 1, 1)],
      transforms: [Skia.RSXform(1, 0, 0, 0)],
      colors: [Skia.Color('transparent')],
    };
  });
  useEffect(() => () => warm.image?.dispose(), [warm]);
  return (
    <Atlas
      colorBlendMode="modulate"
      colors={warm.colors}
      image={warm.image}
      sprites={warm.sprites}
      transforms={warm.transforms}
    />
  );
}

/**
 * The snap itself. One `Atlas`, so one draw call however many tiles there
 * are; every tile's `RSXform` and alpha is written on the UI thread from
 * `progress` into arrays allocated once, so a frame of the snap allocates two
 * scratch objects, not thousands.
 */
function SnapAtlas({
  image,
  width,
  progress,
}: {
  image: SkImage;
  width: number;
  progress: SharedValue<number>;
}) {
  // Latched at mount, like the snapshot it cuts up: sprites, transforms and
  // colours must stay the same length for the life of the draw.
  const [atlas] = useState(() => {
    // The snapshot is taken at device resolution and spans the window's
    // width; its height in points follows from that rather than from the
    // window, since the sheet may reach under the system bars.
    const ratio = width > 0 ? image.width() / width : 1;
    const height = image.height() / ratio;
    const grid = snapGrid(width, height, snapTileSize(width, height));
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

  return (
    <Atlas
      colorBlendMode="modulate"
      colors={colors}
      image={image}
      sprites={atlas.sprites}
      transforms={transforms}
    />
  );
}
