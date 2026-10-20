import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
} from 'react-native-skia';
import { useEffect, useState } from 'react';

import { createRefCountedCache } from '@/lib/ref-counted-cache';
import { useSharedSkiaImage } from '@/lib/skia-image-cache';
import { stageTextureFromPixels, type StageTextureSource } from './stage-scene';

/**
 * Theme pictures as Stage textures. The picture is decoded by the same shared
 * Skia cache Classic and Editorial draw from, then drawn once at the stage's
 * texture cap (<= 2048 px backdrop, <= 1536 px art, §11.7) and read back as
 * RGBA. Converted textures are shared and ref-counted per picture and size, so
 * a theme's light and dark pictures are cached separately and both go within a
 * second of nobody showing them (leaving the layout, or a new theme).
 */
const pending = new Map<string, SkImage>();
const cache = createRefCountedCache<StageTextureSource>({
  load: async (key) => {
    const image = pending.get(key);
    pending.delete(key);
    const maxEdge = Number(key.slice(0, key.indexOf('|')));
    return image ? downsample(image, maxEdge) : null;
  },
  dispose: (source) => source.texture.dispose(),
});

function downsample(image: SkImage, maxEdge: number): StageTextureSource | null {
  const width = image.width();
  const height = image.height();
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  // A CPU surface: the readback below must not wait on a GPU round trip.
  const surface = Skia.Surface.MakeRaster(targetWidth, targetHeight);
  if (!surface) return null;
  try {
    surface
      .getCanvas()
      .drawImageRectOptions(
        image,
        Skia.XYWHRect(0, 0, width, height),
        Skia.XYWHRect(0, 0, targetWidth, targetHeight),
        FilterMode.Linear,
        MipmapMode.None
      );
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    try {
      const pixels = snapshot.readPixels(0, 0, {
        width: targetWidth,
        height: targetHeight,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      });
      if (!(pixels instanceof Uint8Array)) return null;
      return {
        texture: stageTextureFromPixels(pixels, targetWidth, targetHeight),
        aspect: width / height,
      };
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

export type StageTextureState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; source: StageTextureSource }
  | { status: 'failed' };

/** The picture at `uri` as a texture capped at `maxEdge` px, shared while held. */
export function useStageTexture(uri: string | undefined, maxEdge: number): StageTextureState {
  const [failed, setFailed] = useState<string | null>(null);
  const image = useSharedSkiaImage(uri, () => setFailed(uri ?? null));
  const key = uri ? `${Math.round(maxEdge)}|${uri}` : null;
  const [loaded, setLoaded] = useState<{ key: string; source: StageTextureSource } | null>(null);
  useEffect(() => {
    if (!key || !image) return;
    if (!cache.peek(key)) pending.set(key, image);
    const handle = cache.acquire(key);
    let live = true;
    void handle.promise.then((source) => {
      if (!live) return;
      if (source) setLoaded({ key, source });
      else setFailed(uri ?? null);
    });
    return () => {
      live = false;
      handle.release();
    };
  }, [image, key, uri]);
  if (!uri || !key) return { status: 'none' };
  if (failed === uri) return { status: 'failed' };
  if (loaded?.key === key) return { status: 'ready', source: loaded.source };
  return { status: 'loading' };
}
