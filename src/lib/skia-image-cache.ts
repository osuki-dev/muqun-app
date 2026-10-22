import { Skia, type SkImage } from 'react-native-skia';
import { useEffect, useEffectEvent, useState } from 'react';

import { createRefCountedCache, type CacheHandle } from '@/lib/ref-counted-cache';

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

/** Why the last load of each URI failed, for the caller's `onError`; cleared on success. */
const failures = new Map<string, string>();

async function decodeOnce(uri: string): Promise<SkImage | null> {
  try {
    const image = await decode(uri);
    if (image) failures.delete(uri);
    else failures.set(uri, 'The picture could not be decoded');
    return image;
  } catch (error) {
    failures.set(uri, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function decode(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  const lazy = Skia.Image.MakeImageFromEncoded(data);
  if (!lazy) return null;
  let raster: SkImage | null | undefined;
  try {
    // Skia 3 decodes on its worker. readPixels decoded the full hero on JS,
    // preventing navigation and the already-started ripple from committing.
    raster = await lazy.makeRasterImage();
    return raster ?? null;
  } finally {
    if (raster !== lazy) lazy.dispose();
  }
}

/**
 * The decoded picture at `uri`, the same instance for every caller, or null
 * until it has loaded (and for no `uri`). `onError` is called once, with why,
 * when it cannot be loaded; a failure is not cached, so asking again (a new
 * `uri`, or the same one after none) loads it again.
 */
export function useSharedSkiaImage(
  uri: string | null | undefined,
  onError?: (error: string | undefined) => void
): SkImage | null {
  const [loaded, setLoaded] = useState<{ uri: string; handle: CacheHandle<SkImage> } | null>(null);
  const fail = useEffectEvent((failed: string) => onError?.(failures.get(failed)));
  useEffect(() => {
    if (!uri) return;
    const handle = cache.acquire(uri);
    let live = true;
    void handle.promise.then((image) => {
      if (!live) return;
      if (image) setLoaded({ uri, handle });
      else fail(uri);
    });
    return () => {
      live = false;
      handle.release();
    };
  }, [uri]);
  if (!uri) return null;
  // A URI can return after its previous lease was released and disposed.
  // Never reuse that render state or borrow another owner's unleased image.
  return loaded?.uri === uri ? loaded.handle.current() : null;
}

/** Hold decoded images until the newly mounted artwork has acquired its own lease. */
export async function prepareSharedSkiaImages(uris: readonly string[]): Promise<() => void> {
  const handles = [...new Set(uris)].map((uri) => cache.acquire(uri));
  await Promise.all(handles.map((handle) => handle.promise));
  return () => handles.forEach((handle) => handle.release());
}
