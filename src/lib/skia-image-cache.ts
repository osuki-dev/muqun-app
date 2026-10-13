import { Skia, type SkImage } from 'react-native-skia';
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
 * Keep the shared copy on the CPU: Home also samples its alpha to choose the
 * layout and mask. Each Graphite canvas uploads it for drawing. A renderer
 * needing a shared GPU upload can explicitly use makeTextureImage, as the
 * transition cover does, without turning Home's alpha probes into readbacks.
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
  let raster: SkImage | undefined;
  try {
    // Skia 3 decodes on its worker. readPixels decoded the full hero on JS,
    // preventing navigation and the already-started ripple from committing.
    raster = await lazy.makeRasterImage();
    return raster;
  } finally {
    if (raster !== lazy) lazy.dispose();
  }
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

/** Hold decoded images until the newly mounted artwork has acquired its own lease. */
export async function prepareSharedSkiaImages(uris: readonly string[]): Promise<() => void> {
  const handles = [...new Set(uris)].map((uri) => cache.acquire(uri));
  await Promise.all(handles.map((handle) => handle.promise));
  return () => handles.forEach((handle) => handle.release());
}
