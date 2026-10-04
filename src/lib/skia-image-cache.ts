import { AlphaType, ColorType, Skia, type SkImage } from 'react-native-skia';
import { useEffect, useEffectEvent, useState } from 'react';

import { createRefCountedCache } from '@/lib/ref-counted-cache';

/**
 * Decoded theme pictures, shared by every Skia canvas that draws them.
 *
 * The launch opening and Home draw the same files -- the pack's hero, its
 * wallpaper -- and at the launch's exit they are on screen at the same time:
 * the snap carries the opening's copy away over Home's. `useImage` gave each
 * its own `SkImage`, and a Skia image straight from `MakeImageFromEncoded` is
 * lazy, so every canvas that drew one decoded it again. Here a picture is read
 * and decoded once, into a raster image, and that one instance is what every
 * caller gets: the tiles and the page under them are the same pixels.
 *
 * What is not shared is the GPU copy. Under Graphite each canvas has its own
 * recorder, and each recorder uploads a raster image into its own texture
 * cache; Skia's public API has no texture-backed image a second canvas can
 * draw without that upload (the WebGPU texture interop transfers ownership to
 * `react-native-webgpu` and would leak here). So: one file read, one decode,
 * one upload per canvas.
 *
 * Lifetime is `ref-counted-cache.ts`: an image is never disposed while a
 * component that uses it is mounted, and one nobody uses is disposed a second
 * later -- long enough for the opening to hand its picture to Home, short
 * enough that a replaced theme's pictures go with it.
 */

const cache = createRefCountedCache<SkImage>({
  load: decodeOnce,
  dispose: (image) => image.dispose(),
});

async function decodeOnce(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  const lazy = Skia.Image.MakeImageFromEncoded(data);
  if (!lazy) return null;
  const width = lazy.width();
  const height = lazy.height();
  const info = {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Premul,
  };
  // The one decode: into memory now, rather than into every canvas that
  // draws it later. A picture that will not read back stays lazy, which is
  // what every caller had before.
  const pixels = lazy.readPixels(0, 0, info);
  if (!(pixels instanceof Uint8Array)) return lazy;
  const raster = Skia.Image.MakeImage(info, Skia.Data.fromBytes(pixels), width * 4);
  if (!raster) return lazy;
  lazy.dispose();
  return raster;
}

/**
 * The decoded picture at `uri`, the same instance for every caller, or null
 * until it has loaded (and for no `uri`). `onError` is called once when it
 * cannot be loaded.
 */
export function useSharedSkiaImage(
  uri: string | null | undefined,
  onError?: () => void
): SkImage | null {
  const [loaded, setLoaded] = useState<{ uri: string; image: SkImage } | null>(null);
  const fail = useEffectEvent(() => onError?.());
  useEffect(() => {
    if (!uri) return;
    const handle = cache.acquire(uri);
    let live = true;
    void handle.promise.then((image) => {
      if (!live) return;
      if (image) setLoaded({ uri, image });
      else fail();
    });
    return () => {
      live = false;
      handle.release();
    };
  }, [uri]);
  if (!uri) return null;
  if (loaded?.uri === uri) return loaded.image;
  // Already decoded for somebody else: draw it on the first frame.
  return cache.peek(uri);
}
