import { Atlas, Skia, type SkColor, type SkImage, type SkRSXform } from 'react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  snapGrid,
  snapTile,
  snapTileSize,
  snapTileTransform,
  type SnapTile,
  type SnapTransform,
} from '@/lib/snap-dissolve';

/**
 * The opening's exit, drawn inside the opening's own canvas: the frame that
 * canvas was showing, cut into tiles that drift off up and to the right and
 * fade, with Home beneath.
 *
 * It replaces the scene's children in the same `<Canvas>`, so there is no
 * second surface to come up and no frame in which neither is on screen: at
 * `progress = 0` every tile is exactly where it was cut from and the frame is
 * the one the canvas was already presenting. One `Atlas`, so one draw call
 * however many tiles there are; every tile's `RSXform` and alpha is written on
 * the UI thread from `progress` into arrays allocated once, so a frame of the
 * snap allocates two scratch objects, not thousands.
 *
 * A child of Skia's reconciler, so it uses only state, an effect, shared
 * values and an animated reaction -- `useEffectEvent` threw in that renderer.
 * The clock and the snapshot's disposal belong to the scene, in React
 * Native's renderer; this only says when it is ready for the clock.
 */
export function SnapAtlas({
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
  /** Called once the atlas is in the canvas: the moment to start `progress`. */
  onReady: () => void;
}) {
  // Latched at mount, like the snapshot it cuts up: sprites, transforms and
  // colours must stay the same length for the life of the draw. The first
  // transforms are the resting ones, so the very first frame is the picture
  // and not every tile piled at the origin.
  const [atlas] = useState(() => {
    const ratio = width > 0 ? image.width() / width : 1;
    const height = image.height() / ratio;
    // A whole number of device pixels per tile, so that at rest every sprite
    // edge falls on a pixel edge: a tile 47.25 px wide is sampled across its
    // border and the grid shows through the picture as hairlines.
    const tilePx = Math.max(1, Math.round(snapTileSize(width, height) * ratio));
    const grid = snapGrid(width, height, tilePx / ratio);
    const tile: SnapTile = { x: 0, y: 0, w: 0, h: 0, hash: 0, sweep: 0 };
    const out: SnapTransform = { scos: 0, ssin: 0, tx: 0, ty: 0, alpha: 0 };
    const sprites = [];
    const xforms = [];
    const tints = [];
    for (let index = 0; index < grid.count; index++) {
      snapTileTransform(snapTile(grid, index, tile), 0, ratio, out);
      sprites.push(
        Skia.XYWHRect(
          Math.round(tile.x * ratio),
          Math.round(tile.y * ratio),
          Math.round(tile.w * ratio),
          Math.round(tile.h * ratio)
        )
      );
      xforms.push(Skia.RSXform(out.scos, out.ssin, out.tx, out.ty));
      // White at the tile's alpha, multiplied into the sprite (`modulate`).
      // White, so that once Skia premultiplies it the product is the sprite
      // scaled by alpha rather than darkened by it.
      tints.push(Skia.Color('white'));
    }
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

  // Committed into the canvas: the snap can start from its first tile. Once,
  // whatever identity the callback has by the next render.
  const ready = useRef(false);
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    onReady();
  }, [onReady]);

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
